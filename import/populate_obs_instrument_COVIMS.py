################################################################################
# populate_obs_instrument_COVIMS.py
#
# Routines to populate fields specific to COVIMS. It may change fields in
# obs_general, obs_mission_cassini, or obs_instrument_COVIMS.
################################################################################

# Ordering:
#   time_sec1/2 must come before observation_duration
#   planet_id must come before rms_obs_id

import os

from config_data import *
import impglobals
import import_util

from populate_obs_mission_cassini import *


################################################################################
# THESE NEED TO BE IMPLEMENTED FOR EVERY INSTRUMENT
################################################################################

### OBS_GENERAL TABLE ###

def populate_obs_general_COVIMS_rms_obs_id(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    phase_name = metadata['phase_name']
    count = index_row['PRODUCT_ID']

    assert phase_name in ('VIS', 'IR')

    planet_id = helper_cassini_planet_id(**kwargs)
    planet_ltr = ''
    if planet_id is not None:
        planet_ltr = planet_id[0]

    assert count[:2] == '1/'
    image_time = count[2:]

    rms_obs_id = f'{planet_ltr}/CUBE/CO/VIMS/{image_time}/{phase_name}'

    return rms_obs_id

def populate_obs_general_COVIMS_inst_host_id(**kwargs):
    return 'CO'

def populate_obs_general_COVIMS_data_type(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod == 'IMAGE':
        return ('IMG', 'Image')
    if inst_mod == 'LINE':
        return ('LINE', 'Line')
    if inst_mod == 'POINT' or inst_mod == 'OCCULTATION':
        return ('POINT', 'Point')

    index_row_num = metadata['index_row_num']
    import_util.announce_nonrepeating_error(
        f'Unknown INSTRUMENT_MODE_ID "{inst_mod}"', index_row_num)
    return ('IMG', 'Image') # XXX

def populate_obs_general_COVIMS_time1(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    start_time = index_row['START_TIME']
    return start_time

def populate_obs_general_COVIMS_time2(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    stop_time = import_util.safe_column(index_row, 'STOP_TIME')
    return stop_time

def populate_obs_general_COVIMS_target_name(**kwargs):
    return helper_cassini_target_name(**kwargs)

def populate_obs_general_COVIMS_observation_duration(**kwargs):
    metadata = kwargs['metadata']
    obs_general_row = metadata['obs_general_row']
    time_sec1 = obs_general_row['time_sec1']
    time_sec2 = obs_general_row['time_sec2']
    return time_sec2 - time_sec1

def populate_obs_general_COVIMS_quantity(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod == 'OCCULTATION':
        return 'OPTICAL'
    return 'REFLECT'

def populate_obs_general_COVIMS_note(**kwargs):
    None

def populate_obs_general_COVIMS_primary_file_spec(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    return index_row['PATH_NAME']

def populate_obs_general_COVIMS_data_set_id(**kwargs):
    # For VIMS the DATA_SET_ID is provided in the volume label file,
    # not the individual observation rows
    metadata = kwargs['metadata']
    index_label = metadata['index_label']
    dsi = index_label['DATA_SET_ID']
    return (dsi, dsi)

def populate_obs_general_COVIMS_product_id(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    product_id = index_row['PRODUCT_ID']

    return product_id

def populate_obs_general_COVIMS_right_asc1(**kwargs):
    metadata = kwargs['metadata']
    ring_geo_row = metadata.get('ring_geo_row', None)
    if ring_geo_row is not None:
        return import_util.safe_column(ring_geo_row, 'MINIMUM_RIGHT_ASCENSION')

    index_row = metadata['index_row']
    ra = import_util.safe_column(index_row, 'RIGHT_ASCENSION')
    return ra

def populate_obs_general_COVIMS_right_asc2(**kwargs):
    metadata = kwargs['metadata']
    ring_geo_row = metadata.get('ring_geo_row', None)
    if ring_geo_row is not None:
        return import_util.safe_column(ring_geo_row, 'MAXIMUM_RIGHT_ASCENSION')

    index_row = metadata['index_row']
    ra = import_util.safe_column(index_row, 'RIGHT_ASCENSION')
    return ra

def populate_obs_general_COVIMS_declination1(**kwargs):
    metadata = kwargs['metadata']
    ring_geo_row = metadata.get('ring_geo_row', None)
    if ring_geo_row is not None:
        return import_util.safe_column(ring_geo_row, 'MINIMUM_DECLINATION')

    index_row = metadata['index_row']
    dec = import_util.safe_column(index_row, 'DECLINATION')
    return dec

def populate_obs_general_COVIMS_declination2(**kwargs):
    metadata = kwargs['metadata']
    ring_geo_row = metadata.get('ring_geo_row', None)
    if ring_geo_row is not None:
        return import_util.safe_column(ring_geo_row, 'MAXIMUM_DECLINATION')

    index_row = metadata['index_row']
    dec = import_util.safe_column(index_row, 'DECLINATION')
    return dec

def populate_obs_mission_cassini_COVIMS_mission_phase_name(**kwargs):
    return None

### OBS_TYPE_IMAGE TABLE ###

# XXX
def populate_obs_type_image_COVIMS_image_type_id(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if phase_name == 'IR' and inst_mod == 'IMAGE':
        return 'RAST'
    if phase_name == "VIS":
        return 'PUSH'
    return 'RAST' # XXX

def populate_obs_type_image_COVIMS_duration(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']
    index_row = metadata['index_row']
    ir_exp = import_util.safe_column(index_row, 'IR_EXPOSURE')
    vis_exp = import_util.safe_column(index_row, 'VIS_EXPOSURE')

    if phase_name == 'IR':
        if ir_exp is None:
            return None
        return ir_exp/1000
    if vis_exp is None:
        return None
    return vis_exp/1000

def populate_obs_type_image_COVIMS_levels(**kwargs):
    return 4096

def populate_obs_type_image_COVIMS_lesser_pixel_size(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    width = import_util.safe_column(index_row, 'SWATH_WIDTH')
    length = import_util.safe_column(index_row, 'SWATH_LENGTH')

    return min(width, length)

def populate_obs_type_image_COVIMS_greater_pixel_size(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    width = import_util.safe_column(index_row, 'SWATH_WIDTH')
    length = import_util.safe_column(index_row, 'SWATH_LENGTH')

    return max(width, length)


### OBS_WAVELENGTH TABLE ###

def populate_obs_wavelength_COVIMS_wavelength1(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    if phase_name == 'IR':
        return 0.8842
    return 0.35054

def populate_obs_wavelength_COVIMS_wavelength2(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    if phase_name == 'IR':
        return 5.1225
    return 1.04598

def populate_obs_wavelength_COVIMS_wave_res1(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    if phase_name == 'IR':
        return 0.01662
    return 0.0073204

def populate_obs_wavelength_COVIMS_wave_res2(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    if phase_name == 'IR':
        return 0.01662
    return 0.0073204

def populate_obs_wavelength_COVIMS_wave_no1(**kwargs):
    metadata = kwargs['metadata']
    wavelength_row = metadata['obs_wavelength_row']
    return 10000 / wavelength_row['wavelength2'] # cm^-1

def populate_obs_wavelength_COVIMS_wave_no2(**kwargs):
    metadata = kwargs['metadata']
    wavelength_row = metadata['obs_wavelength_row']
    return 10000 / wavelength_row['wavelength1'] # cm^-1

def populate_obs_wavelength_COVIMS_wave_no_res1(**kwargs):
    metadata = kwargs['metadata']
    wl_row = metadata['obs_wavelength_row']
    wave_res2 = wl_row['wave_res2']
    wl2 = wl_row['wavelength2']

    if wave_res2 is None or wl2 is None:
        return None

    return wave_res2 * 10000. / (wl2*wl2)

def populate_obs_wavelength_COVIMS_wave_no_res2(**kwargs):
    metadata = kwargs['metadata']
    wl_row = metadata['obs_wavelength_row']
    wave_res1 = wl_row['wave_res1']
    wl1 = wl_row['wavelength1']

    if wave_res1 is None or wl1 is None:
        return None

    return wave_res1 * 10000. / (wl1*wl1)

def populate_obs_wavelength_COVIMS_spec_flag(**kwargs):
    return 'Y'

def populate_obs_wavelength_COVIMS_spec_size(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    if phase_name == 'IR':
        return 96
    return 256

def populate_obs_wavelength_COVIMS_polarization_type(**kwargs):
    return 'NONE'


################################################################################
# THESE NEED TO BE IMPLEMENTED FOR EVERY CASSINI INSTRUMENT
################################################################################

def populate_obs_mission_cassini_COVIMS_ert1(**kwargs):
    return None

def populate_obs_mission_cassini_COVIMS_ert2(**kwargs):
    return None

def populate_obs_mission_cassini_COVIMS_spacecraft_clock_count1(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    count = import_util.safe_column(index_row, 'SPACECRAFT_CLOCK_START_COUNT')
    return count

def populate_obs_mission_cassini_COVIMS_spacecraft_clock_count2(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    count = import_util.safe_column(index_row, 'SPACECRAFT_CLOCK_STOP_COUNT')
    return count


################################################################################
# THESE ARE SPECIFIC TO OBS_INSTRUMENT_COVIMS
################################################################################

def populate_obs_instrument_COVIMS_channel(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    return (phase_name, phase_name)
