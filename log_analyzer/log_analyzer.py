import argparse
import importlib
import ipaddress
import operator
import sys
from typing import List, Optional

from log_entry import LogReader
from log_parser import LogParser
from ip_to_host_converter import IpToHostConverter

DEFAULT_FIELDS_PREFIX = 'https://tools.pds-rings.seti.org'
LOCAL_SLUGS_PREFIX = 'file:///users/fy/SETI/pds-opus'


def main(arguments: Optional[List[str]] = None) -> None:
    def parse_ignored_ips(x: str) -> List[ipaddress.IPv4Network]:
        return [ipaddress.ip_network(address, strict=False) for address in x.split(',')]

    parser = argparse.ArgumentParser(description='Process log files.')

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--realtime', '--interactive', '-i', '-r', action='store_true',
                       help='Watch a single log file in realtime')
    group.add_argument('--batch', '-b', action='store_true',
                       help='Print a report on one or more completed log files')
    group.add_argument('--summary', action='store_true', dest='summary',
                       help="Show the slugs that have been used in a log file")
    group.add_argument('--xxfake-realtime', action='store_true', help=argparse.SUPPRESS, dest='fake_realtime')

    group2 = parser.add_mutually_exclusive_group()
    group2.add_argument('--by-ip', action='store_true', dest='by_ip',
                        help='Sorts batched logs by host ip')
    group2.add_argument('--by-time', action='store_false', dest='by_ip',
                        help='Sorts batched logs by session start time')

    parser.add_argument('--html', action='store_true', dest='uses_html',
                        help='Generate html output rather than text output')

    parser.add_argument('--api-host-url', default=DEFAULT_FIELDS_PREFIX, metavar='URL', dest='api_host_url',
                        help='base url to access the information')
    parser.add_argument('--reverse-dns', '--dns', action='store_true', dest='uses_reverse_dns',
                        help='Attempt to resolve the real host name')
    parser.add_argument('--ignore-ip', '-x', default=[], action="append", metavar='cidrlist', dest='ignore_ip',
                        type=parse_ignored_ips,
                        help='list of ips to ignore.  May be specified multiple times')
    parser.add_argument('--session-timeout', default=60, type=int, metavar="minutes", dest='session_timeout_minutes',
                        help='a session ends after this period (minutes) of inactivity')

    parser.add_argument('--output', '-o', type=argparse.FileType('w'), default=sys.stdout, dest='output',
                        help="output file.  default is stdout")

    # TODO(fy): Temporary hack for when I don't have internet access
    parser.add_argument('--xxlocal', action="store_true", dest="uses_local", help=argparse.SUPPRESS)
    # TODO(fy): Debugging hack that shows all URLs.
    parser.add_argument('--xxshowall', action='store_true', dest='debug_show_all', help=argparse.SUPPRESS)

    parser.add_argument('log_files', nargs=argparse.REMAINDER, help='log files')
    args = parser.parse_args(arguments)

    # args.ignored_ip comes out as a list of lists, and it needs to be flattened.
    args.ignored_ips = [ip for arg_list in args.ignore_ip for ip in arg_list]
    # Another fake argument we need
    args.ip_to_host_converter = IpToHostConverter.get_ip_to_host_converter(args.uses_reverse_dns, args.uses_local)

    module = importlib.import_module("opus.session_info")
    configuration = module.Configuration(**vars(args)) # type: ignore
    log_parser = LogParser(configuration, **vars(args))

    if args.realtime:
        if len(args.log_files) != 1:
            raise Exception("Must specify exactly one file for batch mode.")
        log_entries_realtime = LogReader.read_logs_from_tailed_file(args.log_files[0])
        log_parser.run_realtime(log_entries_realtime)
    else:
        if len(args.log_files) < 1:
            raise Exception("Must specify at least one log file.")
        log_entries_list = LogReader.read_logs(args.log_files)
        if args.batch:
            log_parser.run_batch(log_entries_list)
        elif args.summary:
            log_parser.run_summary(log_entries_list)
        elif args.fake_realtime:
            log_entries_list.sort(key=operator.attrgetter('time'))
            log_parser.run_realtime(iter(log_entries_list))


if __name__ == '__main__':
    main()
