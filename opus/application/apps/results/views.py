# results/view.py
from collections import OrderedDict
import csv
import json
import logging

import settings

from django.apps import apps
from django.core.cache import cache
from django.core.exceptions import FieldError
from django.db import connection
from django.http import Http404
from django.shortcuts import render
from django.views.decorators.cache import never_cache

# from metadata.views import *
from paraminfo.models import *
from search.models import *
from search.views import (get_param_info_by_slug,
                          get_user_query_table,
                          url_to_search_params)
from user_collections.models import Collections
from tools.app_utils import *
from tools.db_utils import *
from tools.file_utils import *

log = logging.getLogger(__name__)


################################################################################
#
# API INTERFACES
#
################################################################################

def api_get_data(request, fmt):
    """Return a page of data for a given search.

    Get data for observations based on search criteria, columns, and sort order.
    Data is returned by "page" in the same sense that OPUS's "Browse Results"
    display is paginated.

    Format: api/data.(json|zip|html|csv)
    Arguments: limit=<N>
               page=<N>
               order=<column>
               Normal search and selected-column arguments

    In addition to the standard formats, we also allow 'raw' which returns a
    dictionary for internal use.

    Can return JSON, ZIP, HTML, or CSV.

    Returned JSON is of the format:
        data = {
                'page_no': page_no,
                'limit':   limit,
                'order':   order,
                'count':   len(page),
                'labels':  labels,
                'page':    page         # tabular page data
               }
    """
    api_code = enter_api_call('api_get_data', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    ret = get_data(request, fmt)
    if ret is None:
        exit_api_call(api_code, Http404)
        raise Http404

    exit_api_call(api_code, ret)
    return ret


def api_get_metadata(request, opus_id, fmt):
    """Return all metadata, sorted by category, for this opus_id.

    Format: api/metadata/(?P<opus_id>[-\w]+).(?P<fmt>[json|html]+

    Arguments: cols=<columns>
                    Limit results to particular columns.
                    This is a list of slugs separated by commas. Note that the
                    return will be indexed by field name, but by slug name.
                    If cols is supplied, cats is ignored.
               cats=<cats>
                    Limit results to particular categories. Categories can be
                    given as "pretty names" as displayed on the Details page,
                    or can be given as table names.

    Can return JSON, ZIP, HTML, or CSV.

    JSON is indexed by pretty category name, then by INTERNAL DATABASE COLUMN
    NAME (EEK!).
    """
    return _api_get_metadata('api_get_metadata', request, opus_id, fmt)

def api_get_metadata_v2(request, opus_id, fmt):
    """Return all metadata, sorted by category, for this opus_id.

    Format: api/metadata_v2/(?P<opus_id>[-\w]+).(?P<fmt>[json|html]+

    Arguments: cols=<columns>
                    Limit results to particular columns.
                    This is a list of slugs separated by commas. Note that the
                    return will be indexed by field name, but by slug name.
                    If cols is supplied, cats is ignored.
               cats=<cats>
                    Limit results to particular categories. Categories can be
                    given as "pretty names" as displayed on the Details page,
                    or can be given as table names.

    Can return JSON, ZIP, HTML, or CSV.

    JSON is indexed by pretty category name, then by field slug.
    """
    return _api_get_metadata('api_get_metadata_v2', request, opus_id, fmt)

def _api_get_metadata(api_name, request, opus_id, fmt):
    api_code = enter_api_call(api_name, request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    if not opus_id:
        ret = Http404('No OPUS ID')
        exit_api_call(api_code, ret)
        raise ret

    # Backwards compatibility
    opus_id = convert_ring_obs_id_to_opus_id(opus_id)

    cols = request.GET.get('cols', False)
    if cols:
        ret = _get_metadata_by_slugs(request, opus_id, cols.split(','),
                                     fmt,
                                     use_param_names=
                                        (api_name=='api_get_metadata'))
        if ret is None:
            exit_api_call(api_code, Http404)
            raise Http404
        exit_api_call(api_code, ret)
        return ret

    cats = request.GET.get('cats', False)

    data = OrderedDict()     # Holds data struct to be returned
    all_info = OrderedDict() # Holds all the param info objects

    if not cats:
        # Find all the tables (categories) this observation belongs to
        all_tables = (TableNames.objects.filter(display='Y')
                      .order_by('disp_order'))
    else:
        # Restrict tables to those found in cats
        all_tables = ((TableNames.objects.filter(label__in=cats.split(','),
                                                 display='Y') |
                       TableNames.objects.filter(table_name__in=cats.split(','),
                                                 display='Y'))
                      .order_by('disp_order'))

    # Now find all params and their values in each of these tables
    for table in all_tables:
        table_label = table.label
        table_name = table.table_name
        model_name = ''.join(table_name.title().split('_'))

        # Make a list of all slugs and another of all param_names in this table
        param_info_list = list(ParamInfo.objects.filter(category_name=table_name,
                                                        display_results=1)
                                                .order_by('disp_order'))
        if param_info_list:
            for param_info in param_info_list:
                if api_name == 'api_get_metadata':
                    all_info[param_info.name] = param_info
                else:
                    all_info[param_info.slug] = param_info

            try:
                results = query_table_for_opus_id(table_name, opus_id)
            except LookupError:
                log.error('api_get_metadata: Could not find data model for '
                          +'category %s', model_name)
                exit_api_call(api_code, Http404)
                raise Http404

            all_param_names = [p.name for p in param_info_list]
            result_vals = results.values(*all_param_names)
            if not result_vals:
                # This is normal - we're looking at ALL tables so many won't
                # have this OPUS_ID in them.
                continue
            result_vals = result_vals[0]
            ordered_results = OrderedDict()
            for param_info in param_info_list:
                (form_type, form_type_func,
                 form_type_format) = parse_form_type(param_info.form_type)

                if (form_type in settings.MULT_FIELDS and
                    api_name == 'api_get_metadata_v2'):
                    mult_name = get_mult_name(param_info.param_name())
                    mult_val = results.values(mult_name)[0][mult_name]
                    result = lookup_pretty_value_for_mult(param_info, mult_val)
                else:
                    result = result_vals[param_info.name]
                if api_name == 'api_get_metadata':
                    ordered_results[param_info.name] = result
                else:
                    if param_info.slug is not None:
                        ordered_results[param_info.slug] = result
            data[table_label] = ordered_results

    if fmt == 'html':
        # hack because we want to display labels instead of param names
        # on our HTML Detail page
        context = {'data': data,
                   'all_info': all_info}
        if api_name == 'api_get_metadata':
            ret = render(request, 'results/detail_metadata.html', context)
        else:
            ret = render(request, 'results/detail_metadata_v2.html', context)
    if fmt == 'json':
        ret = HttpResponse(json.dumps(data), content_type='application/json')
    if fmt == 'raw':
        ret = data, all_info  # includes definitions for opus interface

    exit_api_call(api_code, ret)
    return ret


@never_cache
def api_get_images_by_size(request, size, fmt):
    """Return all images of a particular size for a given search.

    Format: api/images/(?P<size>[thumb|small|med|full]+).
            (?P<fmt>[json|zip|html|csv]+)
    Arguments: limit=<N>
               page=<N>
               order=<column>
               Normal search arguments

    Can return JSON, ZIP, HTML, or CSV.
    """
    api_code = enter_api_call('api_get_images_by_size', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    session_id = get_session_id(request)

    (page_no, limit, page, opus_ids, ring_obs_ids,
     order) = get_page(request)
    if page is None:
        ret = Http404('Could not find page')
        exit_api_call(api_code, ret)
        raise ret

    image_list = get_pds_preview_images(opus_ids, [size])

    if not image_list:
        log.error('api_get_images_by_size: No image found for: %s',
                  str(opus_ids[:50]))

    # Backwards compatibility
    ring_obs_id_dict = {}
    for i in range(len(opus_ids)):
        ring_obs_id_dict[opus_ids[i]] = ring_obs_ids[i]

    collection_opus_ids = get_all_in_collection(request)
    for image in image_list:
        image['ring_obs_id'] = ring_obs_id_dict[image['opus_id']]
        if size+'_alt_text' in image:
            del image[size+'_alt_text']
        if size+'_size_bytes' in image:
            del image[size+'_size_bytes']
        if size+'_width' in image:
            del image[size+'_width']
        if size+'_height' in image:
            del image[size+'_height']
        if size+'_url' in image:
            root_idx = image[size+'_url'].find('previews/')+9
            path = image[size+'_url'][:root_idx]
            url = image[size+'_url'][root_idx:]
            image['img'] = url
            image['path'] = path
            image[size] = url
            del image[size+'_url']

    ret = responseFormats({'data': image_list}, fmt,
                          template='results/gallery.html', order=order)
    exit_api_call(api_code, ret)
    return ret


@never_cache
def api_get_images(request, fmt):
    """Return all images of all sizes for a given search.

    Format: api/images.(json|zip|html|csv)
    Arguments: limit=<N>
               page=<N>
               order=<column>
               Normal search arguments

    Can return JSON, ZIP, HTML, or CSV.
    """
    api_code = enter_api_call('api_get_images', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    session_id = get_session_id(request)

    columns = request.GET.get('cols', settings.DEFAULT_COLUMNS)

    (page_no, limit, page, opus_ids, ring_obs_ids,
     order) = get_page(request)
    if page is None:
        ret = Http404('Could not find page')
        exit_api_call(api_code, ret)
        raise ret

    # Backwards compatibility
    ring_obs_id_dict = {}
    for i in range(len(opus_ids)):
        ring_obs_id_dict[opus_ids[i]] = ring_obs_ids[i]

    image_list = get_pds_preview_images(opus_ids,
                                        ['thumb', 'small', 'med', 'full'])

    if not image_list:
        log.error('api_get_images: No image found for: %s', str(opus_ids[:50]))

    collection_opus_ids = get_all_in_collection(request)
    for image in image_list:
        image['in_collection'] = image['opus_id'] in collection_opus_ids
        image['ring_obs_id'] = ring_obs_id_dict[image['opus_id']]

    data = {'data': image_list,
            'page_no': page_no,
            'limit': limit,
            'count': len(image_list)}
    ret = responseFormats(data, fmt,
                          template='results/gallery.html', order=order)
    exit_api_call(api_code, ret)
    return ret


def api_get_image(request, opus_id, size='med', fmt='raw'):
    """Return info about a preview image for the given opus_id and size.

    Format: api/image/(?P<size>[thumb|small|med|full]+)/(?P<opus_id>[-\w]+)
            .(?P<fmt>[json|zip|html|csv]+)

    Can return JSON, ZIP, HTML, or CSV.

    The fields 'path' and 'img' are provided for backwards compatibility only.
    """
    api_code = enter_api_call('api_get_image', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    # Backwards compatibility
    opus_id = convert_ring_obs_id_to_opus_id(opus_id)

    image_list = get_pds_preview_images(opus_id, size)
    if len(image_list) != 1:
        log.error('api_get_image: Could not find preview for opus_id "%s" '
                  +'size "%s"', str(opus_id), str(size))
        ret = Http404('No preview image')
        exit_api_call(api_code, ret)
        raise ret

    image = image_list[0]
    path = None
    if size+'_url' in image:
        root_idx = image[size+'_url'].find('previews/')+9
        path = image[size+'_url'][:root_idx]
        url = image[size+'_url'][root_idx:]
        image['img'] = url
        image['path'] = path
        image['img'] = url
        image['url'] = image[size+'_url']
    data = {'path': path, 'data': image_list}
    ret = responseFormats(data, fmt, size=size,
                          template='results/image_list.html')
    exit_api_call(api_code, ret)
    return ret


def api_get_files(request, opus_id=None, fmt='json'):
    """Return all files for a given opus_id or search results.

    Format: api/files/(?P<opus_id>[-\w]+).(?P<fmt>[json|zip|html|csv]+)
        or: api/files.(?P<fmt>[json|zip|html|csv]+)
    Arguments: types=<types>
                    Product types
               loc_type=['url', 'path']

    Can return JSON, ZIP, HTML, or CSV.
    """
    api_code = enter_api_call('api_get_files', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    product_types = request.GET.get('types', 'all')
    loc_type = request.GET.get('loc_type', 'url')

    opus_ids = []
    data = {}
    if opus_id:
        # Backwards compatibility
        opus_id = convert_ring_obs_id_to_opus_id(opus_id)
        opus_ids = [opus_id]
    else:
        # No opus_id passed, get files from search results
        # Override cols because we don't care about anything except
        # opusid
        data = get_data(request, 'raw', cols='opusid')
        if data is None:
            exit_api_call(api_code, Http404)
            raise Http404
        opus_ids = [p[0] for p in data['page']]
        del data['page']
        del data['labels']

    ret = get_pds_products(opus_ids, fmt='raw',
                           loc_type=loc_type,
                           product_types=product_types)
    data['data'] = ret
    exit_api_call(api_code, data)
    return responseFormats(data, fmt=fmt)


def api_get_categories_for_opus_id(request, opus_id):
    """Return a JSON list of all cateories (tables) this opus_id appears in.

    Format: api/categories/(?P<opus_id>[-\w]+).json
    """
    api_code = enter_api_call('api_get_categories_for_opus_id', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    # Backwards compatibility
    opus_id = convert_ring_obs_id_to_opus_id(opus_id)

    all_categories = []
    table_info = (TableNames.objects.all().values('table_name', 'label')
                  .order_by('disp_order'))

    for tbl in table_info:
        table_name = tbl['table_name']
        if table_name == 'obs_surface_geometry':
            # obs_surface_geometry is not a data table
            # It's only used to select targets, not to hold data, so remove it
            continue

        try:
            results = query_table_for_opus_id(table_name, opus_id)
        except LookupError:
            log.error('api_get_categories_for_opus_id: Unable to find table '
                      +'%s', table_name)
            continue
        results = results.values('opus_id')
        if results:
            cat = {'table_name': table_name, 'label': tbl['label']}
            all_categories.append(cat)

    ret = HttpResponse(json.dumps(all_categories),
                       content_type="application/json")
    exit_api_call(api_code, ret)
    return ret


def api_get_categories_for_search(request):
    """Return a JSON list of all cateories (tables) triggered by this search.

    Format: api/categories.json

    Arguments: Normal search arguments
    """
    api_code = enter_api_call('api_get_categories_for_search', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    (selections, extras) = url_to_search_params(request.GET)
    if selections is None:
        log.error('api_get_categories_for_search: Could not find selections for'
                  +' request %s', str(request.GET))
        ret = Http404('Parsing of selections failed')
        exit_api_call(api_code, ret)
        raise ret

    if not selections:
        triggered_tables = settings.BASE_TABLES[:]  # Copy
    else:
        triggered_tables = get_triggered_tables(selections, extras)

    # The main geometry table, obs_surface_geometry, is not table that holds
    # results data. It is only there for selecting targets, which then trigger
    # the other geometry tables. So in the context of returning list of
    # categories it gets removed.
    if 'obs_surface_geometry' in triggered_tables:
        triggered_tables.remove('obs_surface_geometry')

    labels = (TableNames.objects.filter(table_name__in=triggered_tables)
              .values('table_name','label').order_by('disp_order'))

    ret = HttpResponse(json.dumps([ob for ob in labels]),
                       content_type="application/json")
    exit_api_call(api_code, ret)
    return ret


################################################################################
#
# SUPPORT ROUTINES
#
################################################################################

def get_data(request, fmt, cols=None):
    """Return a page of data for a given search and page_no.

    Can return JSON, ZIP, HTML, CSV, or RAW.

    Returned JSON is of the format:
        data = {
                'page_no': page_no,
                'limit':   limit,
                'order':   order,
                'count':   len(page),
                'labels':  labels,
                'page':    page         # tabular page data
                }
    """
    session_id = get_session_id(request)

    (page_no, limit, page, opus_ids, ring_obs_ids, order) = get_page(request)
    if page is None:
        return None

    checkboxes = request.is_ajax()

    if cols is None:
        cols = request.GET.get('cols', settings.DEFAULT_COLUMNS)

    is_column_chooser = request.GET.get('col_chooser', False)

    labels = []
    id_index = None

    for slug_no, slug in enumerate(cols.split(',')):
        if slug == 'opusid':
            id_index = slug_no
        pi = get_param_info_by_slug(slug, from_ui=True)
        if not pi:
            log.error('get_data: Could not find param_info for %s', slug)
            return None
        labels.append(pi.label_results)

    # For backwards compatibility. It would be a lot nicer if we didn't need
    # to know this index at all. See data.html for why we do.
    if id_index is None:
        for slug_no, slug in enumerate(cols.split(',')):
            if slug == 'ringobsid':
                id_index = slug_no

    if is_column_chooser:
        labels.insert(0, 'add') # adds a column for checkbox add-to-collections

    collection = ''
    if request.is_ajax():
        # Find the members of user collection in this page
        # for pre-filling checkboxes
        collection = get_collection_in_page(opus_ids, session_id)

    data = {'page_no': page_no,
            'limit':   limit,
            'page':    page,
            'order':   order,
            'count':   len(page),
            'labels':  labels,
            'columns':  labels # Backwards compatibility with external apps
           }

    if fmt == 'raw':
        ret = data
    ret = responseFormats(data, fmt, template='results/data.html',
                          id_index=id_index,
                          labels=labels, checkboxes=checkboxes,
                          collection=collection, order=order)
    return ret


def get_page(request, colls=None, colls_page=None, page=None):
    """Return a page of results."""
    session_id = get_session_id(request)

    if not colls:
        if request.GET.get('view', 'browse') == 'collection':
            collection_page = True
        else:
            collection_page = False
    else:
        collection_page = colls

    limit = int(request.GET.get('limit', settings.DEFAULT_PAGE_LIMIT))
    cols = request.GET.get('cols', settings.DEFAULT_COLUMNS)

    column_names = []
    tables = set()
    mult_tables = set()
    for slug in cols.split(','):
        # First try the full name, which might include a trailing 1 or 2
        pi = get_param_info_by_slug(slug, from_ui=True)
        if not pi:
            log.error('get_page: Slug "%s" not found', slug)
            return (None, None, None, None, None, None)
        column = pi.param_name()
        table = column.split('.')[0]
        if column.endswith('.opus_id'):
            # opus_id can be displayed from anywhere, but for consistency force
            # it to come from obs_general, since that's the master list.
            # This isn't needed for correctness, just cleanliness.
            table = 'obs_general'
            column = 'obs_general.opus_id'
        tables.add(table)
        (form_type, form_type_func,
         form_type_format) = parse_form_type(pi.form_type)
        if form_type in settings.MULT_FIELDS:
            # For a mult field, we will have to join in the mult table
            # and put the mult column here
            mult_table = get_mult_name(pi.param_name())
            mult_tables.add((mult_table, table))
            column_names.append(mult_table+'.label')
        else:
            column_names.append(column)

    added_extra_columns = 0
    tables.add('obs_general') # We must have obs_general since it owns the ids
    if 'obs_general.opus_id' not in column_names:
        column_names.append('obs_general.opus_id')
        added_extra_columns += 1 # So we know to strip it off later
    if 'obs_general.ring_obs_id' not in column_names:
        column_names.append('obs_general.ring_obs_id')
        added_extra_columns += 1 # So we know to strip it off later

    # Figure out the sort order
    all_order = None
    if collection_page:
        all_order = request.GET.get('colls_order', settings.DEFAULT_SORT_ORDER)
    if not all_order:
        all_order = request.GET.get('order', settings.DEFAULT_SORT_ORDER)
    order_params = []
    descending_params = []
    if all_order:
        orders = all_order.split(',')
        for order in orders:
            descending = order[0] == '-'
            order = order.strip('-')
            pi = get_param_info_by_slug(order, from_ui=True)
            if not pi:
                log.error('get_page: Unable to resolve order slug "%s"', order)
                return (None, None, None, None, None, None)
            (form_type, form_type_func,
             form_type_format) = parse_form_type(pi.form_type)
            if form_type in settings.MULT_FIELDS:
                mult_table = get_mult_name(pi.param_name())
                order_param = mult_table + '.label'
            else:
                order_param = pi.param_name()
            table = order_param.split('.')[0]
            if order_param not in column_names:
                tables.add(table)
                column_names.append(order_param)
                added_extra_columns += 1 # So we know to strip it off later
            order_params.append(order_param)
            descending_params.append(descending)

    # Figure out what page we're asking for
    if collection_page:
        if colls_page:
            page_no = colls_page
        else:
            page_no = request.GET.get('colls_page', 1)
    else:
        if page:
            page_no = page
        else:
            page_no = request.GET.get('page', 1)
    if page_no != 'all':
        try:
            page_no = int(page_no)
        except:
            log.error('get_page: Unable to parse page "%s"',
                      str(page_no))
            return (None, None, None, None, None, None)

    if not collection_page:
        # This is for a search query

        # Create the SQL query
        # There MUST be some way to do this in Django, but I just can't figure
        # it out. It's incredibly easy to do in raw SQL, so we just do that
        # instead. -RF
        (selections, extras) = url_to_search_params(request.GET)
        if selections is None:
            log.error('get_page: Could not find selections for'
                      +' request %s', str(request.GET))
            return (None, None, None, None, None, None)

        user_query_table = get_user_query_table(selections, extras)
        if not user_query_table:
            log.error('get_page: get_user_query_table failed '
                      +'*** Selections %s *** Extras %s',
                      str(selections), str(extras))
            return (None, None, None, None, None, None)

        sql = 'SELECT '
        sql += ','.join(column_names)
        sql += ' FROM '+connection.ops.quote_name('obs_general')

        # All the column tables are LEFT JOINs because if the table doesn't
        # have an entry for a given opus_id, we still want the row to show up,
        # just full of NULLs.
        for table in tables:
            if table == 'obs_general':
                continue
            sql += ' LEFT JOIN '+connection.ops.quote_name(table)
            sql += ' ON '+connection.ops.quote_name('obs_general')+'.id='
            sql += connection.ops.quote_name(table)+'.obs_general_id'

        # Now JOIN in all the mult_ tables.
        for (mult_table, table) in mult_tables:
            sql += ' LEFT JOIN '+connection.ops.quote_name(mult_table)
            sql += ' ON '+connection.ops.quote_name(table)+'.'+mult_table+'='
            sql += connection.ops.quote_name(mult_table)+'.id'

        # But the cache table is an INNER JOIN because we only want opus_ids
        # that appear in the cache table to cause result rows
        sql += ' INNER JOIN '+connection.ops.quote_name(user_query_table)
        sql += ' ON '+connection.ops.quote_name('obs_general')+'.id='
        sql += connection.ops.quote_name(user_query_table)+'.id'
    else:
        # This is for a collection
        sql = 'SELECT '
        sql += ','.join(column_names)
        sql += ' FROM '+connection.ops.quote_name('obs_general')

        # All the column tables are LEFT JOINs because if the table doesn't
        # have an entry for a given opus_id, we still want the row to show up,
        # just full of NULLs.
        for table in tables:
            if table == 'obs_general':
                continue
            sql += ' LEFT JOIN '+connection.ops.quote_name(table)
            sql += ' ON '+connection.ops.quote_name('obs_general')+'.id='
            sql += connection.ops.quote_name(table)+'.obs_general_id'

        # Now JOIN in all the mult_ tables.
        for (mult_table, table) in mult_tables:
            sql += ' LEFT JOIN '+connection.ops.quote_name(mult_table)
            sql += ' ON '+connection.ops.quote_name(table)+'.'+mult_table+'='
            sql += connection.ops.quote_name(mult_table)+'.id'

        # But the collections table is an INNER JOIN because we only want
        # opus_ids that appear in the collections table to cause result rows
        sql += ' INNER JOIN '+connection.ops.quote_name('collections')
        sql += ' ON '+connection.ops.quote_name('obs_general')+'.id='
        sql += connection.ops.quote_name('collections')+'.obs_general_id'
        sql += ' AND '
        sql += connection.ops.quote_name('collections')+'.session_id='
        sql += '"'+session_id+'"'

    # Add in the ordering
    if order_params:
        order_str_list = []
        for i in range(len(order_params)):
            s = order_params[i]
            if descending_params[i]:
                s += ' DESC'
            else:
                s += ' ASC'
            order_str_list.append(s)
        sql += ' ORDER BY ' + ','.join(order_str_list)

    """
    the limit is pretty much always 100, the user cannot change it in the interface
    but as an aide to finding the right chunk of a result set to search for
    for the 'add range' click functinality, the front end may send a large limit, like say
    page_no = 42 and limit = 400
    that means start the page at 42 and go 4 pages, and somewhere in there is our range
    this is how 'add range' works accross multiple pages
    so the way of computing starting offset here should always use the base_limit of 100
    using the passed limit will result in the wrong offset because of way offset is computed here
    this may be an awful hack.
    """
    if page_no != 'all':
        base_limit = 100  # explainer of sorts is above
        offset = (page_no-1)*base_limit
        sql += ' LIMIT '+str(limit)
        sql += ' OFFSET '+str(offset)

    time1 = time.time()

    cursor = connection.cursor()
    cursor.execute(sql)
    results = cursor.fetchall()

    log.debug('get_page SQL (%.2f secs): %s', time.time()-time1, sql)

    # Return a simple list of opus_ids
    opus_id_index = column_names.index('obs_general.opus_id')
    opus_ids = [o[opus_id_index] for o in results]

    # And for backwards compatibility, ring_obs_ids
    ring_obs_id_index = column_names.index('obs_general.ring_obs_id')
    ring_obs_ids = [o[ring_obs_id_index] for o in results]

    # Strip off the opus_id if the user didn't actually ask for it initially
    if added_extra_columns:
        results = [o[:-added_extra_columns] for o in results]

    # There might be real None entries, which means the join returned null
    # data. Replace these so they look prettier.
    results = [[x if x is not None else 'N/A' for x in r] for r in results]

    return (page_no, limit, results, opus_ids, ring_obs_ids,
            all_order)


def _get_metadata_by_slugs(request, opus_id, slugs, fmt, use_param_names):
    "Returns results for specified slugs."
    params_by_table = OrderedDict()
    all_info = OrderedDict()

    for slug in slugs:
        param_info = get_param_info_by_slug(slug, from_ui=True)
        if not param_info:
            log.error('_get_metadata_by_slugs: Could not find param_info entry '
                      +'for slug %s', str(slug))
            return None
        table_name = param_info.category_name
        params_by_table.setdefault(table_name, []).append((param_info, slug))
        # Note we are intentionally using "slug" here instead of
        # param_info.slug, which means we might get an old slug and index with
        # it. But at least that way the requested column and the given result
        # will match for the user.
        all_info[slug] = param_info

    data_dict = {}

    for table_name, param_info_slug_list in params_by_table.items():
        try:
            results = query_table_for_opus_id(table_name, opus_id)
        except LookupError:
            continue
        if not results:
            # this opus_id doesn't exist in this table, log this..
            log.error('_get_metadata_by_slugs: Could not find opus_id %s in '
                      +'table %s', opus_id, table_name)
            return None
        for param_info, slug in param_info_slug_list:
            (form_type, form_type_func,
             form_type_format) = parse_form_type(param_info.form_type)

            if form_type in settings.MULT_FIELDS and not use_param_names:
                mult_name = get_mult_name(param_info.param_name())
                mult_val = results.values(mult_name)[0][mult_name]
                result = lookup_pretty_value_for_mult(param_info, mult_val)
            else:
                result = results.values(param_info.name)[0][param_info.name]
            if use_param_names:
                data_dict[param_info.name] = result
            else:
                data_dict[slug] = result

    # Now put them in the right order
    data = []
    for slug in slugs:
        param_name = all_info[slug].name
        if use_param_names:
            data.append({param_name: data_dict[param_name]})
        else:
            data.append({slug: data_dict[slug]})

    if fmt == 'html':
        if use_param_names:
            template = 'results/detail_metadata_slugs.html'
        else:
            template = 'results/detail_metadata_slugs_v2.html'
        return render(request, template,
                      {'data': data,
                       'all_info': all_info})
    if fmt == 'json':
        return HttpResponse(json.dumps(data), content_type="application/json")
    if fmt == 'raw':
        return data, all_info  # includes definitions for OPUS interface


def get_triggered_tables(selections, extras):
    "Returns the tables triggered by the selections including the base tables."
    if not selections:
        return sorted(settings.BASE_TABLES)

    user_query_table = get_user_query_table(selections, extras)
    if not user_query_table:
        log.error('get_triggered_tables: get_user_query_table failed '
                  +'*** Selections %s *** Extras %s',
                  str(selections), str(extras))
        return None

    cache_key = None
    if user_query_table:
        cache_key = 'triggered_tables:' + user_query_table
        cached_val = cache.get(cache_key)
        if cached_val is not None:
            return cached_val

    triggered_tables = settings.BASE_TABLES[:]

    # Now see if any more tables are triggered from query
    queries = {}
    for partable in Partables.objects.all():
        # We are joining the results of a user's query - the single column
        # table of ids - with the trigger_tab listed in the partable
        trigger_tab = partable.trigger_tab
        trigger_col = partable.trigger_col
        trigger_val = partable.trigger_val
        partable = partable.partable

        if partable in triggered_tables:
            continue  # Already triggered, no need to check

        if trigger_tab + trigger_col in queries:
            results = queries[trigger_tab + trigger_col]
        else:
            trigger_model = apps.get_model('search',
                                           ''.join(trigger_tab.title()
                                                   .split('_')))
            results = trigger_model.objects
            if selections:
                if trigger_tab == 'obs_general':
                    where = connection.ops.quote_name(trigger_tab) + '.id='
                    where += user_query_table + '.id'
                else:
                    where = connection.ops.quote_name(trigger_tab)
                    where += '.obs_general_id='
                    where += connection.ops.quote_name(user_query_table) + '.id'
                results = results.extra(where=[where], tables=[user_query_table])
            results = results.distinct().values(trigger_col)
            queries.setdefault(trigger_tab + trigger_col, results)

        if len(results) == 1 and results[0][trigger_col] == trigger_val:
            triggered_tables.append(partable)

        # Surface geometry has multiple targets per observation
        # so we just want to know if our val is in the result
        # (not the only result)
        if 'obs_surface_geometry.target_name' in selections:
            if (trigger_tab == 'obs_surface_geometry' and
                trigger_val.upper() ==
                selections['obs_surface_geometry.target_name'][0].upper()):
                if (trigger_val.upper() in
                    [r['target_name'].upper() for r in results]):
                    triggered_tables.append(partable)

    # Now hack in the proper ordering of tables
    final_table_list = []
    for table in (TableNames.objects.filter(table_name__in=triggered_tables)
                  .values('table_name').order_by('disp_order')):
        final_table_list.append(table['table_name'])

    if cache_key:
        cache.set(cache_key, final_table_list)

    return final_table_list


def get_all_in_collection(request):
    "Return a list of all OPUS IDs in the collection."
    session_id = get_session_id(request)
    res = (Collections.objects.filter(session_id__exact=session_id)
           .values_list('opus_id'))
    opus_ids = [x[0] for x in res]
    return opus_ids


def get_collection_in_page(opus_id_list, session_id):
    """Returns obs_general_ids in page that are also in user collection.

    This is for views in results where you have to display the gallery
    and indicate which thumbnails are in cart.
    """
    if not session_id:
        return

    cursor = connection.cursor()
    collection_in_page = []
    sql = 'SELECT DISTINCT opus_id FROM '
    sql += connection.ops.quote_name('collections')
    sql += ' WHERE session_id=%s'
    cursor.execute(sql, [session_id])
    rows = cursor.fetchall()
    coll_ids = [r[0] for r in rows]
    ret = [opus_id for opus_id in opus_id_list if opus_id in coll_ids]
    return ret
