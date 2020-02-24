#!/bin/bash
if [ $# -ne 2 ];
then
    echo 'Usage: import_all.sh production_database_name "-u<username> -p<password> -h <hostname>"'
    exit 1
fi
if [[ ! `hostname` =~ "tools" ]];
then
    echo "Please only run this script on tools.pds-rings.seti.org"
    exit 1
fi
echo "************************************************************"
echo "***** About to import ALL PDS DATA into a new database *****"
echo "************************************************************"
echo
echo "The current production database is:"
grep "^DB_SCHEMA_NAME" /home/django/src/pds-opus/opus_secrets.py
echo
echo "About to ERASE and import to this database:" $1
echo "with these parameters:" $2
echo "Note this should be the production-style name, not the dev-style name"
read -p "ARE YOU SURE? " -n 1 -r
echo    # (optional) move to a new line
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    exit 1
fi
source ~/p3venv/activate
pip install -r ../../requirements-python3.txt
echo "Running import with nohup - check nohup.out for status"
nohup ./_import_all_internal.sh "$1" "$2"
