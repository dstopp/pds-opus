################################################################################
# populate_obs_surface_geo.py
#
# Routines to populate fields in the obs_surface_geometry,
# obs_surface_geometry_name, and obs_surface_geometry__<TARGET> tables.
################################################################################

from config_data import *

import import_util

# This is the target_name field in obs_surface_geometry that has the many-to-one
# mapping of rows to OPUS IDs
def populate_obs_surface_geo_name_target_name(**kwargs):
    metadata = kwargs['metadata']
    surface_geo_row = metadata['body_surface_geo_row']

    target_name = surface_geo_row['TARGET_NAME'].upper()
    if target_name in TARGET_NAME_MAPPING:
        target_name = TARGET_NAME_MAPPING[target_name]
    if target_name not in TARGET_NAME_INFO:
        import_util.announce_unknown_target_name(target_name)
        return None
    return (target_name, import_util.cleanup_target_name(target_name))

# These are fields in the normal obs_surface_geometry table that have the
# standard one-to-one mapping with OPUS ID
def populate_obs_surface_geo_target_list(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    target_list = metadata['body_surface_geo_target_list']
    if target_list is None:
        return None

    return ','.join(sorted(target_list))
