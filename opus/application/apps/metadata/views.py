# metadata/views.py
from collections import OrderedDict
import json
import logging

from django.apps import apps
from django.db import connection
from django.core.cache import cache
from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Max, Min, Count
from django.http import Http404, HttpResponse

from paraminfo.models import ParamInfo
from search.models import *
from search.views import (get_param_info_by_slug,
                          get_user_query_table,
                          set_user_search_number,
                          url_to_search_params)
from tools.app_utils import *
import opus_support

log = logging.getLogger(__name__)


################################################################################
#
# API INTERFACES
#
################################################################################

def api_get_result_count(request, fmt='json'):
    """Return the result count for a given search.

    Format: api/meta/result_count.(?P<fmt>[json|zip|html|csv]+)
    Arguments: Normal search and selected-column arguments

    Can return JSON, ZIP, HTML, or CSV.

    Returned JSON is of the format:
        data = [
                 {
                   'result_count': result_count
                 }
               ]
    """
    api_code = enter_api_call('api_get_data', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    (selections, extras) = url_to_search_params(request.GET)
    if selections is None:
        log.error('api_get_result_count: Could not find selections for '
                  +'request %s', str(request.GET))
        ret = Http404('Parsing of selections failed')
        exit_api_call(api_code, ret)
        raise ret

    table = get_user_query_table(selections, extras)

    if not table:
        log.error('api_get_result_count: Could not find query table for '
                  +'request %s', str(request.GET))
        ret = Http404('Parsing of selections failed')
        exit_api_call(api_code, ret)
        raise ret

    cache_key = 'resultcount:' + table
    count = cache.get(cache_key)
    if count is None:
        cursor = connection.cursor()
        sql = ('SELECT COUNT(*) FROM '
               + connection.ops.quote_name(table))
        cursor.execute(sql)
        try:
            count = cursor.fetchone()[0]
        except:
            count = 0

        cache.set(cache_key, count)

    data = {'result_count': count}

    if (request.is_ajax()):
        data['reqno'] = request.GET['reqno']

    ret = responseFormats({'data': [data]}, fmt,
                          template='metadata/result_count.html')
    exit_api_call(api_code, ret)
    return ret


def api_get_mult_counts(request, slug, fmt='json'):
    """Return the mults for a given slug along with result counts.

    Format: api/meta/mults/(?P<slug>[-\w]+).(?P<fmt>[json|zip|html|csv]+)
    Arguments: Normal search arguments

    Can return JSON, ZIP, HTML, or CSV.

    Returned JSON is of the format:
        { 'field': slug,
          'mults': mults }
    mult is a list of entries pairing mult name and result count.
    """
    api_code = enter_api_call('api_get_data', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    (selections, extras) = url_to_search_params(request.GET)
    if selections is None:
        log.error('api_get_mult_counts: Failed to get selections for slug %s, '
                  +'URL %s', str(slug), request.GET)
        ret = Http404('Parsing of selections failed')
        exit_api_call(api_code, ret)
        raise ret

    param_info = get_param_info_by_slug(slug)
    if not param_info:
        log.error('api_get_mult_counts: Could not find param_info entry for '
                  +'slug %s *** Selections %s *** Extras %s', str(slug),
                  str(selections), str(extras))
        ret = Http404('Unknown slug')
        exit_api_call(api_code, ret)
        raise ret

    table_name = param_info.category_name
    param_name = param_info.param_name()

    # If this param is in selections already we want to remove it
    # We want mults for a param as they would be without itself
    if param_name in selections:
        del selections[param_name]

    has_selections = False
    if selections:
        has_selections = True

    cache_key = ('mults_' + param_name + '_'
                 + str(set_user_search_number(selections)))

    cached_val = cache.get(cache_key)
    if cached_val is not None:
        mults = cached_val
    else:
        mult_name = get_mult_name(param_name)
        try:
            mult_model = apps.get_model('search',
                                        mult_name.title().replace('_',''))
        except LookupError:
            log.error('api_get_mult_counts: Could not get_model for %s',
                      mult_name.title().replace('_',''))
            exit_api_call(api_code, Http404)
            raise Http404

        try:
            table_model = apps.get_model('search',
                                         table_name.title().replace('_',''))
        except LookupError:
            log.error('api_get_mult_counts: Could not get_model for %s',
                      table_name.title().replace('_',''))
            exit_api_call(api_code, Http404)
            raise Http404

        results = (table_model.objects.values(mult_name)
                   .annotate(Count(mult_name)))

        user_table = get_user_query_table(selections, extras)

        if selections and not user_table:
            log.error('api_get_mult_counts: has selections but no user_table '
                      +'found *** Selections %s *** Extras %s',
                      str(selections), str(extras))
            exit_api_call(api_code, Http404)
            raise Http404

        if selections:
            # selections are constrained so join in the user_table
            if table_name == 'obs_general':
                where = [connection.ops.quote_name(table_name) + '.id='
                         + connection.ops.quote_name(user_table) + '.id']
            else:
                where = [connection.ops.quote_name(table_name)
                         + '.obs_general_id='
                         + connection.ops.quote_name(user_table) + '.id']
            results = results.extra(where=where, tables=[user_table])

        mult_result_list = []
        for row in results:
            mult_id = row[mult_name]
            try:
                mult = mult_model.objects.get(id=mult_id)
                mult_disp_order = mult.disp_order
                mult_label = mult.label
            except ObjectDoesNotExist:
                log.error('api_get_mult_counts: Could not find mult entry for '
                          +'mult_model %s id %s', str(mult_model), str(mult_id))
                mult_label = str(mult_id)
                mult_disp_order = 0

            mult_result_list.append((mult_disp_order,
                                     (mult_label,
                                      row[mult_name + '__count'])))
        mult_result_list.sort()

        mults = OrderedDict()  # info to return
        for _, mult_info in mult_result_list:
            mults[mult_info[0]] = mult_info[1]

        cache.set(cache_key, mults)

    multdata = {'field': slug,
                'mults': mults }

    if (request.is_ajax()):
        reqno = request.GET.get('reqno', '')
        multdata['reqno'] = reqno

    ret = responseFormats(multdata, fmt, template='metadata/mults.html')
    exit_api_call(api_code, ret)
    return ret


def api_get_range_endpoints(request, slug, fmt='json'):
    """Compute and return range widget endpoints (min, max, nulls)

    Compute and return range widget endpoints (min, max, nulls) for the
    widget defined by [slug] based on current search defined in request.

    Format: api/meta/range/endpoints/(?P<slug>[-\w]+)
            .(?P<fmt>[json|zip|html|csv]+)
    Arguments: Normal search arguments

    Can return JSON, ZIP, HTML, or CSV.

    Returned JSON is of the format:
        { min: 63.592, max: 88.637, nulls: 2365}

    Note that min and max can be strings, not just real numbers. This happens,
    for example, with spacecraft clock counts, and may also happen with
    floating point values when we want to force a particular display format
    (such as full-length numbers instead of exponential notation).
    """
    api_code = enter_api_call('api_get_range_endpoints', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    param_info = get_param_info_by_slug(slug)
    if not param_info:
        log.error('get_range_endpoints: Could not find param_info entry for '+
                  'slug %s', str(slug))
        ret = Http404('Unknown slug')
        exit_api_call(api_code, ret)
        raise ret

    param_name = param_info.name # Just name
    full_param_name = param_info.param_name() # category.name
    (form_type, form_type_func,
     form_type_format) = parse_form_type(param_info.form_type)
    table_name = param_info.category_name
    try:
        table_model = apps.get_model('search',
                                     table_name.title().replace('_',''))
    except LookupError:
        log.error('api_get_range_endpoints: Could not get_model for %s',
                  table_name.title().replace('_',''))
        exit_api_call(api_code, Http404)
        raise Http404

    param_no_num = strip_numeric_suffix(param_name)
    param1 = param_no_num + '1'
    param2 = param_no_num + '2'

    if form_type == 'RANGE' and param_info.slug[-1] not in '12':
        param1 = param2 = param_no_num  # single column range query

    (selections, extras) = url_to_search_params(request.GET)
    if selections is None:
        log.error('api_get_range_endpoints: Could not find selections for '
                  +'request %s', str(request.GET))
        ret = Http404('Parsing of selections failed')
        exit_api_call(api_code, ret)
        raise ret

    # Remove this param from the user's query if it is constrained.
    # This keeps the green hinting numbers from reacting to changes to its
    # own field.
    param_name_no_num = strip_numeric_suffix(full_param_name)
    for to_remove in [param_name_no_num,
                      param_name_no_num + '1',
                      param_name_no_num + '2']:
        if to_remove in selections:
            del selections[to_remove]
    if selections:
        user_table = get_user_query_table(selections, extras)
        if user_table is None:
            log.error('api_get_range_endpoints: Count not retrieve query table'
                      +' for *** Selections %s *** Extras %s',
                      str(selections), str(extras))
            ret = Http404('Parsing of selections failed')
            exit_api_call(api_code, ret)
            raise ret
    else:
        user_table = None

    # Is this result already cached?
    cache_key = 'rangeep:' + param_name_no_num
    if user_table:
        cache_key += str(set_user_search_number(selections, extras))

    cached_val = cache.get(cache_key)
    if cached_val is not None:
        ret = responseFormats(cached_val, fmt, template='metadata/mults.html')
        exit_api_call(api_code, ret)
        return ret

    # We didn't find a cache entry, so calculate the endpoints
    results = table_model.objects

    if selections:
        # There are selections, so tie the query to user_table
        if table_name == 'obs_general':
            where = (connection.ops.quote_name(table_name) + '.id='
                     + connection.ops.quote_name(user_table) + '.id')
        else:
            where = (connection.ops.quote_name(table_name)
                     + '.obs_general_id='
                     + connection.ops.quote_name(user_table) + '.id')
        range_endpoints = (results.extra(where=[where], tables=[user_table]).
                           aggregate(min=Min(param1), max=Max(param2)))

        where += ' AND ' + param1 + ' IS NULL AND ' + param2 + ' IS NULL'
        range_endpoints['nulls'] = results.extra(where=[where],
                                                 tables=[user_table]).count()
    else:
        # There are no selections, so hit the whole table
        range_endpoints = results.all().aggregate(min=Min(param1),
                                                  max=Max(param2))
        where = param1 + ' IS NULL AND ' + param2 + ' IS NULL'
        range_endpoints['nulls'] = results.all().extra(where=[where]).count()

    if form_type_func is not None:
        # We need to run some arbitrary function to convert from float to
        # some kind of string. This happens for spacecraft clock count
        # and time fields, among others.
        if form_type_func in opus_support.RANGE_FUNCTIONS:
            func = opus_support.RANGE_FUNCTIONS[form_type_func][0]
            if range_endpoints['min'] is not None:
                range_endpoints['min'] = func(range_endpoints['min'])
            if range_endpoints['max'] is not None:
                range_endpoints['max'] = func(range_endpoints['max'])
        else:
            log.error('Unknown RANGE function "%s"', form_type_func)

    if form_type_format:
        try:
            range_endpoints['min'] = format(range_endpoints['min'],
                                            form_type_format)
        except TypeError:
            pass
        try:
            range_endpoints['max'] = format(range_endpoints['max'],
                                            form_type_format)
        except TypeError:
            pass
    else:
        try:
            if abs(range_endpoints['min']) > 999000:
                range_endpoints['min'] = format(1.0*range_endpoints['min'],'.3')
        except TypeError:
            pass

        try:
            if abs(range_endpoints['max']) > 999000:
                range_endpoints['max'] = format(1.0*range_endpoints['max'],'.3')
        except TypeError:
            pass

    cache.set(cache_key, range_endpoints)

    ret = responseFormats(range_endpoints, fmt, template='metadata/mults.html')
    exit_api_call(api_code, ret)
    return ret


def api_get_fields(request, fmt='json', field=''):
    """Return information about fields in the database (slugs).

    This is helper method for people using the public API.
    It's provides a list of all slugs in the database and helpful info
    about each one like label, dict/more_info links, etc.

    Format: api/fields/(?P<field>\w+).(?P<fmt>[json|zip|html|csv]+)
        or: api/fields.(?P<fmt>[json|zip|html|csv]+)

    Can return JSON, ZIP, HTML, or CSV.

    Returned JSON is of the format:
            surfacegeometryJUPITERsolarhourangle: {
                more_info: {
                    def: false,
                    more_info: false
                },
                label: "Solar Hour Angle"
            }
    """
    api_code = enter_api_call('api_get_fields', request)

    if not request or request.GET is None:
        ret = Http404('No request')
        exit_api_call(api_code, ret)
        raise ret

    ret = get_fields_info(fmt, field, collapse=True)

    exit_api_call(api_code, ret)
    return ret


################################################################################
#
# SUPPORT ROUTINES
#
################################################################################

def get_fields_info(fmt, field='', category='', collapse=False):
    "Helper routine for api_get_fields."
    cache_key = 'getFields:field:' + field + ':category:' + category
    return_obj = cache.get(cache_key)
    if return_obj is None:
        if field:
            fields = ParamInfo.objects.filter(slug=field)
        elif category:
            fields = ParamInfo.objects.filter(category_name=category)
        else:
            fields = ParamInfo.objects.all()
        fields.order_by('category_name', 'slug')

        # We cheat with the HTML return because we want to collapse all the
        # surface geometry down to a single target version to save screen
        # space. This is a horrible hack, but for right now we just assume
        # there will always be surface geometry data for Saturn.
        return_obj = OrderedDict()
        for f in fields:
            if (collapse and
                f.slug.startswith('SURFACEGEO') and
                not f.slug.startswith('SURFACEGEOsaturn')):
                continue
            entry = OrderedDict()
            table_name = TableNames.objects.get(table_name=f.category_name)
            entry['label'] = f.label_results
            collapsed_slug = f.slug
            if collapse:
                entry['category'] = table_name.label.replace('Saturn',
                                                             '<TARGET>')
                collapsed_slug = entry['slug'] = f.slug.replace('saturn',
                                                                '<TARGET>')
            else:
                entry['category'] = table_name.label
                entry['slug'] = f.slug
            if f.old_slug and collapse:
                entry['old_slug'] = f.old_slug.replace('saturn', '<TARGET>')
            else:
                entry['old_slug'] = f.old_slug
            return_obj[collapsed_slug] = entry

        cache.set(cache_key, return_obj)

    if fmt == 'raw':
        return return_obj

    return responseFormats({'data': return_obj}, fmt=fmt,
                           template='metadata/fields.html')
