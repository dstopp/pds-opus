#!/bin/sh
rm -f /tmp/_*models.py
python manage.py inspectdb > /tmp/_models.py
if [ `grep Cache /tmp/_models.py | wc -l` -ne 0 ]
then
  echo "Must clear out caches before running!"
else
  sed -e 's/rms_obs =/rms_obs_id =/g' < /tmp/_models.py > /tmp/__models.py
  sed -e "s/rms_obs_id = models.ForeignKey(ObsGeneral, models.DO_NOTHING)/rms_obs_id = models.ForeignKey(ObsGeneral, models.DO_NOTHING, related_name='%(class)s_rms_obs_id')/g" < /tmp/__models.py > apps/search/models.py
fi