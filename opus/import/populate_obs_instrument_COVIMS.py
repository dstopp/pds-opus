################################################################################
# populate_obs_instrument_COVIMS.py
#
# Routines to populate fields specific to COVIMS.
################################################################################

# Ordering:
#   time_sec1/2 must come before observation_duration
#   planet_id must come before opus_id

import os

import pdsfile

from config_data import *
import impglobals
import import_util

from populate_obs_mission_cassini import *


################################################################################
# THESE NEED TO BE IMPLEMENTED FOR EVERY INSTRUMENT
################################################################################

### OBS_GENERAL TABLE ###

def _COVIMS_file_spec_helper(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    # Format: "/data/1999010T054026_1999010T060958"
    path_name = index_row['PATH_NAME']
    # Format: "v1294638283_1.qub"
    file_name = index_row['FILE_NAME']
    volume_id = kwargs['volume_id']

    return volume_id + path_name + '/' + file_name

def populate_obs_general_COVIMS_opus_id(**kwargs):
    metadata = kwargs['metadata']
    file_spec = _COVIMS_file_spec_helper(**kwargs)
    pds_file = pdsfile.PdsFile.from_filespec(file_spec)
    try:
        opus_id = pds_file.opus_id
    except:
        metadata = kwargs['metadata']
        index_row = metadata['index_row']
        import_util.log_nonrepeating_error(
            f'Unable to create OPUS_ID for FILE_SPEC "{file_spec}"')
        return file_spec
    phase_name = metadata['phase_name']
    opus_id += '_' + phase_name
    return opus_id

def populate_obs_general_COVIMS_ring_obs_id(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    filename = index_row['FILE_NAME']
    image_num = filename[1:11]
    phase_name = metadata['phase_name']
    planet = helper_cassini_planet_id(**kwargs)
    if planet is None:
        pl_str = ''
    else:
        pl_str = planet[0]

    return pl_str + '_CUBE_CO_VIMS_' + image_num + '_' + phase_name

def populate_obs_general_COVIMS_inst_host_id(**kwargs):
    return 'CO'

def populate_obs_general_COVIMS_quantity(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod == 'OCCULTATION':
        return 'OPTICAL'
    return 'REFLECT'
    # XXX CAL?

def populate_obs_general_COVIMS_spatial_sampling(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod.startswith('CAL'):
        return None

    if inst_mod == 'POINT' or inst_mod == 'OCCULTATION':
        return 'POINT'
    if inst_mod == 'LINE':
        return '1D'
    if inst_mod == 'IMAGE':
        return '2D'

    import_util.log_nonrepeating_error(
        f'Unknown INSTRUMENT_MODE_ID "{inst_mod}"')
    return None

def populate_obs_general_COVIMS_wavelength_sampling(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod == 'OCCULTATION':
        return 'N'
    return 'Y'

def populate_obs_general_COVIMS_time_sampling(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod.startswith('CAL'):
        return None
    if inst_mod == 'OCCULTATION':
        return 'Y'
    return 'N'

def populate_obs_general_COVIMS_time1(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    start_time = index_row['START_TIME']

    if start_time is None:
        return None

    try:
        start_time_sec = julian.tai_from_iso(start_time)
    except:
        import_util.log_nonrepeating_error(
            f'Bad start time format "{start_time}"')
        return None

    return julian.iso_from_tai(start_time_sec, digits=3, ymd=True)

def populate_obs_general_COVIMS_time2(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    stop_time = import_util.safe_column(index_row, 'STOP_TIME')

    if stop_time is None:
        return None

    try:
        stop_time_sec = julian.tai_from_iso(stop_time)
    except:
        import_util.log_nonrepeating_error(
            f'Bad stop time format "{stop_time}"')
        return None

    return julian.iso_from_tai(stop_time_sec, digits=3, ymd=True)

def populate_obs_general_COVIMS_target_name(**kwargs):
    return helper_cassini_target_name(**kwargs)

def populate_obs_general_COVIMS_observation_duration(**kwargs):
    metadata = kwargs['metadata']
    obs_general_row = metadata['obs_general_row']
    time_sec1 = obs_general_row['time_sec1']
    time_sec2 = obs_general_row['time_sec2']
    return max(time_sec2 - time_sec1, 0)

def populate_obs_general_COVIMS_note(**kwargs):
    None

def populate_obs_general_COVIMS_primary_file_spec(**kwargs):
    return _COVIMS_file_spec_helper(**kwargs)

def populate_obs_general_COVIMS_product_creation_time(**kwargs):
    metadata = kwargs['metadata']
    index_label = metadata['index_label']
    pct = index_label['PRODUCT_CREATION_TIME']
    return pct

# Format: "CO-E/V/J/S-VIMS-2-QUBE-V1.0"
def populate_obs_general_COVIMS_data_set_id(**kwargs):
    # For VIMS the DATA_SET_ID is provided in the volume label file,
    # not the individual observation rows
    metadata = kwargs['metadata']
    index_label = metadata['index_label']
    dsi = index_label['DATA_SET_ID']
    return (dsi, dsi)

# Format: "1/1294638283_1"
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
    return helper_cassini_mission_phase_name(**kwargs)

def populate_obs_mission_cassini_COVIMS_sequence_id(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    seqid = index_row['SEQ_ID']
    return seqid


### OBS_TYPE_IMAGE TABLE ###

def populate_obs_type_image_COVIMS_image_type_id(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod != 'IMAGE':
        return None
    if phase_name == 'VIS':
        return 'PUSH'
    return 'RAST'

def populate_obs_type_image_COVIMS_duration(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod != 'IMAGE':
        return None

    phase_name = metadata['phase_name']
    ir_exp = import_util.safe_column(index_row, 'IR_EXPOSURE')
    vis_exp = import_util.safe_column(index_row, 'VIS_EXPOSURE')

    if phase_name == 'IR':
        if ir_exp is None:
            return None
        if ir_exp < 0:
            import_util.log_nonrepeating_warning(f'IR Exposure {ir_exp} is < 0')
            return None
        return ir_exp/1000
    if vis_exp is None:
        return None
    if vis_exp < 0:
        import_util.log_nonrepeating_warning(f'VIS Exposure {vis_exp} is < 0')
        return None
    return vis_exp/1000

# XXX
def populate_obs_type_image_COVIMS_levels(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod != 'IMAGE':
        return None

    return 4096

def populate_obs_type_image_COVIMS_lesser_pixel_size(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod != 'IMAGE':
        return None

    width = import_util.safe_column(index_row, 'SWATH_WIDTH')
    length = import_util.safe_column(index_row, 'SWATH_LENGTH')

    return min(width, length)

def populate_obs_type_image_COVIMS_greater_pixel_size(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    inst_mod = index_row['INSTRUMENT_MODE_ID']

    if inst_mod != 'IMAGE':
        return None

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
        return 256
    return 96

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
    count = index_row['SPACECRAFT_CLOCK_START_COUNT']
    return '1/' + count

def populate_obs_mission_cassini_COVIMS_spacecraft_clock_count2(**kwargs):
    metadata = kwargs['metadata']
    index_row = metadata['index_row']
    count = index_row['SPACECRAFT_CLOCK_STOP_COUNT']
    return '1/' + count


################################################################################
# THESE ARE SPECIFIC TO OBS_INSTRUMENT_COVIMS
################################################################################

def populate_obs_instrument_COVIMS_channel(**kwargs):
    metadata = kwargs['metadata']
    phase_name = metadata['phase_name']

    return (phase_name, phase_name)
