###############################################
#
#   search.views
#
################################################
import sys
import hashlib
from operator import __or__ as OR
import julian
import json
from pyparsing import ParseException
from django.conf import settings
from django.db.models import Q
from django.apps import apps
from django.db.models.sql.datastructures import EmptyResultSet
from django.db import connection, DatabaseError
from django.core.cache import cache
import settings
import opus_support

from search.models import *
from tools.app_utils import *
from tools.db_utils import *
from paraminfo.models import ParamInfo

import logging
log = logging.getLogger(__name__)


def get_param_info_by_slug(slug, from_ui=False):
    # If from_ui is true, we try stripping the trailing '1' off a slug
    # as well, because single-value slugs come in with this gratuitous
    # '1' on the end

    # Try the current slug names first

    slug_no_num = strip_numeric_suffix(slug)

    try:
        return ParamInfo.objects.get(slug=slug_no_num)
    except ParamInfo.DoesNotExist:
        pass

    try:
        return ParamInfo.objects.get(slug=slug)
    except ParamInfo.DoesNotExist:
        pass

    try:
        # qtypes for ranges come through as the param_name_no num
        # which doesn't exist in param_info, so grab the param_info
        # for the lower side of the range
        return ParamInfo.objects.get(slug=slug + '1')
    except ParamInfo.DoesNotExist:
        pass

    if from_ui:
        try:
            return ParamInfo.objects.get(slug=slug.strip('1'))
        except ParamInfo.DoesNotExist:
            pass

    # Now try the same thing but with the old slug names
    try:
        return ParamInfo.objects.get(old_slug=slug_no_num)
    except ParamInfo.DoesNotExist:
        pass

    try:
        return ParamInfo.objects.get(old_slug=slug)
    except ParamInfo.DoesNotExist:
        pass

    try:
        return ParamInfo.objects.get(old_slug=slug + '1')
        # this is not a query param, ignore it
    except ParamInfo.DoesNotExist:
        pass

    if from_ui:
        try:
            return ParamInfo.objects.get(old_slug=slug.strip('1'))
        except ParamInfo.DoesNotExist:
            pass

    log.error('get_param_info_by_slug: Slug "%s" not found', slug)

    return None

def get_param_info_by_param(param_name):
    cat_name      = param_name.split('.')[0]
    name          = param_name.split('.')[1]

    try:
        return ParamInfo.objects.get(category_name=cat_name, name=name)
    except ParamInfo.DoesNotExist:
        # single column range queries will not have the numeric suffix
        try:
            name_no_num = strip_numeric_suffix(name)
            return ParamInfo.objects.get(category_name=cat_name, name=name_no_num)
        except ParamInfo.DoesNotExist:
            return False

def is_single_column_range(param_name):
    cat_name      = param_name.split('.')[0]
    name          = param_name.split('.')[1]

    try:
        param_info = ParamInfo.objects.get(category_name=cat_name, name=name)
        return False
    except ParamInfo.DoesNotExist:
        # single column range queries will not have the numeric suffix
        try:
            name_no_num = strip_numeric_suffix(name)
            return ParamInfo.objects.get(category_name=cat_name, name=name_no_num)
        except ParamInfo.DoesNotExist:
            return False


def construct_query_string(selections, extras):

    all_qtypes = extras['qtypes'] if 'qtypes' in extras else []
    # keeping track of some things
    long_queries = []  # special longitudinal queries are pure sql
    string_queries = []  # special handling for string queries ugh!
    q_objects = []  # for building up the query object
    finished_ranges = []  # ranges are done for both sides at once.. so track which are finished to avoid duplicates

    # buld the django query
    for param_name, value_list in selections.items():

        # lookup info about this param_name
        param_name_no_num = strip_numeric_suffix(param_name)  # this is used later for other things!
        cat_name, name = param_name.split('.')
        cat_model_name = ''.join(cat_name.lower().split('_'))
        param_info = get_param_info_by_param(param_name)
        if not param_info:
            log.error('construct_query_string: No param_info for %s', param_name)
            log.error('.. Selections: %s', str(selections))
            log.error('.. Extras: %s', str(extras))
            return None, None

        (form_type, form_type_func,
         form_type_format) = parse_form_type(param_info.form_type)

        special_query = param_info.special_query

        # define any qtypes for this param_name from query
        qtypes = all_qtypes[param_name_no_num] if param_name_no_num in all_qtypes else []

        # now build the q_objects to run the query, by form_type:

        # MULTs
        if form_type in settings.MULT_FORM_TYPES:
            mult_name = get_mult_name(param_name)
            model_name = mult_name.title().replace('_','')
            model = apps.get_model('search',model_name)
            mult_values = [x['pk'] for x in list(model.objects.filter(Q(label__in=value_list) | Q(value__in=value_list) ).values('pk'))]
            if cat_name != 'obs_general':
                q_objects.append(Q(**{"%s__%s__in" % (cat_model_name, mult_name): mult_values }))
            else:
                q_objects.append(Q(**{"%s__in" % mult_name: mult_values }))

        # RANGE
        if form_type in settings.RANGE_FIELDS:

            # this prevents range queries from getting through twice
            # if one range side has been processed can skip the 2nd, it gets done when the 1st is
            if param_name_no_num in finished_ranges:
                # this range has already been done, skip to next param in the loop
                continue

            finished_ranges += [param_name_no_num]

            # longitude queries
            if special_query == 'long':
                # this parameter requires a longitudinal query
                # these are crazy sql and can't use Django's model interface
                # so after converting the rest of the query params from django model
                # statements to sql these are tacked on at the end
                # both sides of range must be defined by user for this to work
                if selections[param_name_no_num + '1'] and selections[param_name_no_num + '2']:
                    lq, lq_params = longitudeQuery(selections,param_name)
                    long_queries.append((lq, lq_params))

                else:
                    raise ValidationError


            else:
                # get the range query object and append it to the query
                q_obj = range_query_object(selections, param_name, qtypes)

                q_objects.append(q_obj)


        # STRING
        if form_type == 'STRING':
            q_obj = string_query_object(param_name, value_list, qtypes)
            q_objects.append(q_obj)

    # construct our query, we'll be breaking into raw sql, but for that
    # we'll be using the sql django generates through its model interface
    try:
        sql, params = ObsGeneral.objects.filter(*q_objects).values('pk').query.sql_with_params()

        # append any longitudinal queries to the query string
        if long_queries:

            params = list(params)

            # q += " ".join([" and (%s) " % long_query for long_query in long_queries])
            if 'where' in sql.lower():
                sql = sql + ' AND obs_general.id in '
            else:
                sql = sql + ' where obs_general.id in '


            sql = sql + ' AND obs_general.id in '.join([" (%s) " % long_query[0] for long_query in long_queries])
            for long_q in long_queries:
                params += list(long_query[1])

            params = tuple(params)

        return sql, params

    except EmptyResultSet:
        return None, None



def get_user_query_table(selections=None, extras=None):
    """Perform a data search and create a table of matching IDs.

    This is THE main data query place. Performs a data search and creates
    a table of IDs (obs_general_id) that match the result rows.

    Note: The function url_to_search_params take the user http request object
          and creates the data objects that are passed to this function)
    """
    cursor = connection.cursor()

    if not extras:
        extras = {}
    if not selections:
        selections = {}

    # Create a cache key
    cache_table_num  = set_user_search_number(selections,extras)
    cache_table_name = get_user_search_table_name(cache_table_num)

    # Is this key set in the cache?
    cache_key = 'cache_table:' + str(cache_table_num)

    cached_val = cache.get(cache_key)
    if cached_val:
        return cached_val

    # Is this key set in the database?
    try:
        desc_sql = 'desc ' + connection.ops.quote_name(cache_table_name)
        cursor.execute(desc_sql)
    except DatabaseError,e:
        if e.args[0] != MYSQL_TABLE_NOT_EXISTS:
            log.error('get_user_query_table: "%s" returned %s',
                      desc_sql, str(e))
            return None
    else:
        cache.set(cache_key, cache_table_name)
        return cache_table_name

    # Cache table does not exist
    # We will make one by doing some data querying
    sql, params = construct_query_string(selections, extras)
    if sql is None:
        log.error('get_user_query_table: construct_query_string failed')
        log.error('.. Selections: %s', str(selections))
        log.error('.. Extras: %s', str(extras))
        return None

    if not sql:
        log.error('get_user_query_table: Query string is empty')
        log.error('.. Selections: %s', str(selections))
        log.error('.. Extras: %s', str(extras))
        return None

    try:
        # With this we can create a table that contains the single column
        create_sql = ('CREATE TABLE '
                      + connection.ops.quote_name(cache_table_name)
                      + ' ' + sql)
        cursor.execute(create_sql, tuple(params))
    except DatabaseError,e:
        if e.args[0] == MYSQL_TABLE_ALREADY_EXISTS:
            log.error('get_user_query_table: Table "%s" originally didn\'t '+
                      'exist, but now it does!', cache_table_name)
            return cache_table_name
        else:
            log.error('get_user_query_table: "%s" with params "%s" failed with '
                      +'%s', create_sql, str(tuple(params)), str(e))
    try:
        alter_sql = ('ALTER TABLE '
                     + connection.ops.quote_name(cache_table_name)
                     + ' ADD UNIQUE KEY(id)')
        cursor.execute(alter_sql)
    except DatabaseError,e:
        log.error('get_user_query_table: "%s" with params "%s" failed with %s',
                  alter_sql, str(tuple(params)), str(e))
        return None

    cache.set(cache_key, cache_table_name)
    return cache_table_name


def url_to_search_params(request_get):
    """
    OPUS lets users put nice readable things in the URL, like "planet=Jupiter" rather than "planet_id=3"
    this function takes the url params and translates it into a list that contains 2 dictionaries
    the first dict is the user selections: keys of the dictionary are param_names of data columns in
    the data table values are always lists and represent the users selections
    the 2nd dict is any extras being passed by user, like qtypes that define what types of queries
    will be performed for each param-value set in the first dict

    NOTE: pass request_get = request.GET to this func please
    (this func doesn't return an http response so unit tests freak if you pass it an http request :)

    example command line usage:

    >>>> from search.views import *
    >>>> from django.http import QueryDict
    >>>> q = QueryDict("planet=Saturn")
    >>>> (selections,extras) = url_to_search_params(q)
    >>>> selections
    {'planet_id': [u'Saturn']}
    >>>> extras
    {'qtypes': {}}

    """
    selections = {}
    qtypes     = {}

    for searchparam in request_get.items():
        slug = searchparam[0]
        if slug in settings.SLUGS_NOT_IN_DB:
            continue
        slug_no_num = strip_numeric_suffix(slug)
        values = searchparam[1].strip(',').split(',')

        qtype = False  # assume this is not a qtype statement
        if slug.startswith('qtype'): # like qtype-time=ZZZ
            qtype = True  # this is a statement of query type!
            slug = slug.split('-')[1]
            slug_no_num = strip_numeric_suffix(slug)
            if slug_no_num != slug:
                log.error('search.views:url_to_search_params qtype slug has '+
                          'numeric suffix "%s", slug')
                continue

        param_info = get_param_info_by_slug(slug)
        if not param_info:
            log.error('search.views:url_to_search_params unknown slug "%s"',
                      slug)
            continue

        param_name = param_info.param_name()
        (form_type, form_type_func,
         form_type_format) = parse_form_type(param_info.form_type)

        param_name_no_num = strip_numeric_suffix(param_name)

        if qtype:
            qtypes[param_name_no_num] = values
            continue

        if form_type in settings.MULT_FORM_TYPES:
            # mult form types can be sorted to save duplicate queries being
            # built
            selections[param_name] = sorted(values)
        else:
            # no other form types can be sorted since their ordering
            # corresponds to qtype ordering
            if searchparam[1]:  # if it has a value
                if form_type == "RANGE":
                    if form_type_func is None:
                        func = float
                    else:
                        if form_type_func in opus_support.RANGE_FUNCTIONS:
                            func = opus_support.RANGE_FUNCTIONS[form_type_func][1]
                        else:
                            log.error('Unknown RANGE function "%s"',
                                      form_type_func)
                            func = float
                    if param_name == param_name_no_num:
                        # this is a single column range query
                        ext = slug[-1]
                        try:
                            selections[param_name + ext] = map(func, values)
                        except ValueError,e:
                            log.error(
                                'Function "%s" threw ValueError(%s) for %s',
                                func, e, values)
                    else:
                        # normal 2-column range query
                        try:
                            selections[param_name] = map(func, values)
                        except ValueError,e:
                            log.error(
                                'Function "%s" threw ValueError(%s) for %s',
                                func, e, values)
                else:
                    selections[param_name] = values

        # except: pass # the param passed doesn't exist or is a USER PREF AAAAAACK

    if selections:
        extras  = {}
        extras['qtypes'] = qtypes

        return selections, extras

    else:
        return [{}, {}]


def set_user_search_number(selections=None,extras=None):
    """
    creates a new row in userSearches model for every search request
    [cleanup,optimize]
    this table (model) lists query params+values plus any extra info needed to run a data search query
    this method looks in user_searches table for current selections
    if none exist creates it, returns id key
    """
    if not bool(extras): extras = {}

    if not bool(selections): selections = {}

    qtypes_json = qtypes_hash = None
    if 'qtypes' in extras:
        # 'any' is the default qtype, so lets not set that in the cache, set 'any' = None
        for k,qlist in extras['qtypes'].items():
            extras['qtypes'][k] = [x if x != 'any' else None for x in qlist]
            if len(extras['qtypes'][k])==1 and extras['qtypes'][k][0]==None:
                extras['qtypes'].pop(k)
        if len(extras['qtypes']):
            qtypes_json = str(json.dumps(sortDict(extras['qtypes'])))
            qtypes_hash = hashlib.md5(qtypes_json).hexdigest()

    units_json = units_hash = None
    if 'units' in extras:
        units_json = str(json.dumps(sortDict(extras['units'])))
        units_hash = hashlib.md5(units_json).hexdigest()

    string_selects_json = string_selects_hash = None
    if 'string_selects' in extras:
        string_selects_json = str(json.dumps(sortDict(extras['string_selects'])))
        string_selects_hash = hashlib.md5(string_selects_json).hexdigest()


    selections_json = str(json.dumps(selections))
    selections_hash = hashlib.md5(selections_json).hexdigest()

    # do we already have this cached?
    cache_key = 'usersearchno:selections_hash:' + str(selections_hash) + ':qtypes_hash:' +  str(qtypes_hash) + ':units_hash:' + str(units_hash) + ':string_selects_hash:' + str(string_selects_hash)
    if (cache.get(cache_key)):
        return cache.get(cache_key)

    # no cache, let's keep going..
    try:
        s = UserSearches.objects.get(selections_hash=selections_hash,qtypes_hash=qtypes_hash,units_hash=units_hash,string_selects_hash=string_selects_hash)
    except UserSearches.MultipleObjectsReturned:
        s = UserSearches.objects.filter(selections_hash=selections_hash,qtypes_hash=qtypes_hash,units_hash=units_hash,string_selects_hash=string_selects_hash)[0]
    except UserSearches.DoesNotExist:
        s = UserSearches(selections_hash=selections_hash, selections_json=selections_json, qtypes=qtypes_json,qtypes_hash=qtypes_hash,units=units_json,units_hash=units_hash, string_selects=string_selects_json,string_selects_hash=string_selects_hash )
        s.save()

    cache.set(cache_key,s.id)

    return s.id


def string_query_object(param_name, value_list, qtypes):

    cat_name, param = param_name.split('.')
    model_name = cat_name.lower().replace('_','')

    if param == 'opus_id':
        # Special case, because opus_id is always a foreign key field, which
        # is just an integer in Django. So we have to look through the foreign
        # key into the destination table (always obs_general) to get the
        # actual string.
        param_model_name = 'opus_id'
    elif model_name == 'obsgeneral':
        param_model_name = param
    else:
        param_model_name = model_name + '__' + param

    if len(value_list) > 1:
        log.error('string_query_object: value_list for param %s contains >1 item %s qtypes %s', param_name, str(value_list), str(qtypes))

    # This can apparently handle multiple string values, but it's not really implemented fully
    # Maybe it should return a list of q_exp?
    for val_no,value in enumerate(value_list):
        qtype = qtypes[val_no] if len(qtypes) > val_no else 'contains'
        if qtype == 'contains':
            q_exp = Q(**{"%s__icontains" % param_model_name: value })
        elif qtype == 'begins':
            q_exp = Q(**{"%s__startswith" % param_model_name: value })
        elif qtype == 'ends':
            q_exp = Q(**{"%s__endswith" % param_model_name: value })
        elif qtype == 'matches':
            q_exp = Q(**{"%s" % param_model_name: value })
        elif qtype == 'excludes':
            q_exp = ~Q(**{"%s__icontains" % param_model_name: value })
        else:
            log.error('string_query_object: Unknown qtype %s for param_name %s', qtype, param_name)

    return q_exp

def range_query_object(selections, param_name, qtypes):
    """
    builds query for numeric ranges where 2 data columns represent min and max values
    oh and also single column ranges

    # just some text for searching this file
    any all only
    any / all / only
    any/all/only

    """
    # grab some info about this param
    param_info = get_param_info_by_param(param_name)
    if not param_info:
        return False

    (form_type, form_type_func,
     form_type_format) = parse_form_type(param_info.form_type)
    table_name = param_info.category_name

    # we will define both sides of the query, so define those param names
    param_name_no_num = strip_numeric_suffix(param_name)
    param_name_min = param_name_no_num + '1'
    param_name_max = param_name_no_num + '2'

    # grab min and max values from query selections object
    values_min = selections[param_name_min] if param_name_min in selections else []
    values_max = selections[param_name_max] if param_name_max in selections else []

    # but, for constructing the query,
    # if this is a single column range, the param_names are both the same
    if is_single_column_range(param_name):
        param_name_min = param_name_max = param_name_no_num

    # to follow related models, we need the lowercase model name, not the param name
    # UNLESS this param is in the obs_General table, then must leave out the model name!
    if table_name == 'obs_general':
        param_model_name_min = param_name_min.split('.')[1]
        param_model_name_max = param_name_max.split('.')[1]
    else:
        param_model_name_min = table_name.lower().replace('_','') + '__' + param_name_min.split('.')[1]
        param_model_name_max = table_name.lower().replace('_','') + '__' + param_name_max.split('.')[1]

    # we need to know how many times to go through this loop
    count = max(len(values_min), len(values_max))  # sometimes you can have queries
                                                   # that define multiple ranges for same widget
                                                   # (not currently implemented in UI)

    if count < len(qtypes):
        log.error('Passed qtypes is shorter in length than longest range values list, defaulting to "any"')
        log.error('.. values_min: %s', str(values_min))
        log.error('.. values_max: %s', str(values_max))
        log.error('.. qtypes: %s', str(qtypes))

    # XXX This is really awful. What happens if there are a different number
    # of qtypes and values?

    # now collect the query expressions
    all_query_expressions = []  # these will be joined by OR
    i=0
    while i < count:

        # define some things
        value_min, value_max = None, None
        try:
            value_min = values_min[i]
        except IndexError:
            pass

        try:
            value_max = values_max[i]
        except IndexError:
            pass

        try:
            qtype = qtypes[i]
        except IndexError:
            qtype = ['any']

        # reverse value_min and value_max if value_min < value_max
        if value_min is not None and value_max is not None:
            (value_min,value_max) = sorted([value_min,value_max])

        # we should end up with 2 query expressions
        q_exp, q_exp1, q_exp2 = None, None, None  # q_exp will hold the concat
                                                  # of q_exp1 and q_exp2

        if qtype == 'all':

            if value_min is not None:
                # param_name_min <= value_min
                q_exp1 = Q(**{"%s__lte" % param_model_name_min: value_min })

            if value_max is not None:
                # param_name_max >= value_max
                q_exp2 = Q(**{"%s__gte" % param_model_name_max: value_max })

        elif qtype == 'only':

            if value_min is not None:
                # param_name_min >= value_min
                q_exp1 = Q(**{"%s__gte" % param_model_name_min: value_min })

            if value_max is not None:
                # param_name_max <= value_max
                q_exp2 = Q(**{"%s__lte" % param_model_name_max: value_max })

        else: # defaults to qtype = any
            if value_max is not None:
                # param_name_min <= value_max
                q_exp1 = Q(**{"%s__lte" % param_model_name_min: value_max })

            if value_min is not None:
                # param_name_max >= value_min
                q_exp2 = Q(**{"%s__gte" % param_model_name_max: value_min })

        # put the query expressions together as "&" queries
        if q_exp1 and q_exp2:
            q_exp = q_exp1 & q_exp2
        elif q_exp1:
            q_exp = q_exp1
        elif q_exp2:
            q_exp = q_exp2

        all_query_expressions.append(q_exp)
        i+=1


    # now we have all query expressions, join them with 'OR'
    return reduce(OR, all_query_expressions)


def longitudeQuery(selections,param_name):
    # raises 'KeyError' or IndexError if min or max value is blank
    # or ranges are lopsided, all ranges for LONG query must have both sides
    # defined returns string sql

    clauses = []  # we may have a number of clauses to piece together
    params  = []  # we are building a sql string

    cat_name = param_name.split('.')[0]
    name = param_name.split('.')[1]
    name_no_num = strip_numeric_suffix(name)
    param_name_no_num = strip_numeric_suffix(param_name)
    param_name_min = param_name_no_num + '1'
    param_name_max = param_name_no_num + '2'
    col_d_long = cat_name + '.d_' + name_no_num

    values_min = selections[param_name_min]
    values_max = selections[param_name_max]

    if len(values_min) != len(values_max):
        raise KeyError

    count = len(values_max)
    i=0
    while i < count:

        value_min = values_min[i]
        value_max = values_max[i]

        # find the midpoint and dx of the user's range
        if (value_max >= value_min):
            longit = (value_min + value_max)/2.
            d_long = longit - value_min
        else:
            longit = (value_min + value_max + 360.)/2.
            d_long = longit - value_min

        if (longit >= 360): longit = longit - 360.

        if d_long:
            clauses += ["(abs(abs(mod(%s - " + param_name_no_num + " + 180., 360.)) - 180.) <= %s + " + col_d_long + ")"];
            params  += [longit,d_long]

        i+=1

    clause = ' OR '.join(clauses)

    table_name = param_name_no_num.split('.')[0]

    key_field = 'obs_general_id' if cat_name != 'obs_general' else 'obs_general.id'

    query = "select " + key_field + " from " + table_name + " where " + clause

    return query, tuple(params)


def convertTimes(value_list):
    """ other conversion scripts are 'seconds_to_time','seconds_to_et' """
    converted = []
    for time in value_list:
        try:
            (day, sec, timetype) = julian.day_sec_type_from_string(time)
            time_sec = julian.tai_from_day(day) + sec
            converted += [time_sec]
        except ParseException:
            log.error("Could not convert time: %s", time)
            converted += [None]
    return converted


def get_user_search_table_name(num):
    """ pass cache_no, returns user search table name"""
    return 'cache_' + str(num);
