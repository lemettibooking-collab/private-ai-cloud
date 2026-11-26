"""Manual, runner-only evidence reproduction; no production binding or dispatch flag."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
from urllib.parse import urlencode

BASE = '94306785c100dc00eb0d41a28f84fe5b6bad63c7'
PREFIX = 'file:///Users/rabota2/Desktop/IT/Private%20AI%20Cloud/private-ai-cloud/'
INPUTS = {
    'integration.original.txt': '10838a242e149b4be52bed5bdb4bed0d0e5303bf98eec57e99cc071f4b3d5211',
    'SOURCE.sha256': '62af90f961758fc18cf49c0c0ef11109efa4468aacbb1f1e01543f42b1312bc8',
    'focused-pg-command.txt': '517e46f5a9feb2f45c22badb0ed9aaa531b53152f5199639da868cc6e83b519a',
}
ALLOWED = {'.github/workflows/pac-dev02-e01.yml'} | {
    '.github/pac-dev02/' + f for f in [*INPUTS, 'verify.py', 'README.md']
}
REPO = Path(__file__).resolve().parents[2]
BUNDLE = REPO / '.github/pac-dev02'
PG = Path('/usr/lib/postgresql/16/bin')
COMMANDS = []
# Only non-secret process configuration is inherited by npm/Node/PG, never GITHUB_TOKEN,
# DATABASE_URL, provider credentials, user NODE_OPTIONS or live-PG override variables.
ENV = {k: os.environ[k] for k in ('PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR') if k in os.environ}
ENV.update(CI='true', NEXT_TELEMETRY_DISABLED='1', NO_COLOR='1')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(name, value):
    (EVIDENCE / name).write_text(json.dumps(value, indent=2) + '\n')


def command(name, args, env=None, timeout=1200):
    with (EVIDENCE / (name + '.log')).open('w') as log:
        child = subprocess.Popen(args, cwd=REPO, env=env or ENV, stdout=log,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        try:
            rc = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            rc = 124
    COMMANDS.append({'name': name, 'argv': args, 'exitCode': rc})
    write('commands.json', COMMANDS)
    print(name + ': exit ' + str(rc), flush=True)
    return rc


def checked(name, args, **options):
    if command(name, args, **options) != 0:
        raise RuntimeError(name + ' failed; see evidence log')


def output(args):
    return subprocess.check_output(args, cwd=REPO, env=ENV, text=True).strip()


def verify_sources():
    for name, expected in INPUTS.items():
        if digest(BUNDLE / name) != expected:
            raise RuntimeError('Original input checksum mismatch: ' + name)
    rows = (BUNDLE / 'SOURCE.sha256').read_text().splitlines()
    if len(rows) != 633:
        raise RuntimeError('Original source inventory count mismatch')
    migrations = []
    for row in rows:
        expected, name = row.split('  ', 1)
        if digest(REPO / name) != expected:
            raise RuntimeError('Baseline source mismatch: ' + name)
        if name.startswith('db/migrations/'):
            migrations.append(name)
    if len(migrations) != 29 or set(migrations) != {
            str(f.relative_to(REPO)) for f in (REPO / 'db/migrations').glob('*.sql')}:
        raise RuntimeError('Migration inventory mismatch')
    if set(output(['git', 'diff', '--name-only', BASE, 'HEAD']).splitlines()) - ALLOWED:
        raise RuntimeError('Candidate changes outside isolated workflow bundle')
    if output(['git', 'status', '--porcelain', '--untracked-files=all']):
        raise RuntimeError('Checkout/index not clean')
    # Next must never load a local environment/credential file.
    if any((REPO / f).exists() for f in ('.env', '.env.local', '.env.production',
                                        '.env.production.local', '.env.test', '.env.test.local')):
        raise RuntimeError('Unexpected local environment file')
    checked('baseline-ancestor', ['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'])
    checked('diff-check', ['git', 'diff', '--check', BASE, 'HEAD'])
    write('source-integrity.json', {'baseline': BASE, 'candidate': output(['git', 'rev-parse', 'HEAD']),
          'tree': output(['git', 'rev-parse', 'HEAD^{tree}']), 'sourceCount': 633,
          'migrationCount': 29, 'runtimeDispatchAllowed': False})


def relocate():
    original = (BUNDLE / 'integration.original.txt').read_bytes()
    relocated = original.replace(PREFIX.encode(), (REPO.as_uri() + '/').encode())
    if original.count(PREFIX.encode()) != 14 or relocated.replace(
            (REPO.as_uri() + '/').encode(), PREFIX.encode()) != original:
        raise RuntimeError('Harness relocation is not byte-reversible')
    for name in re.findall(re.escape(PREFIX) + r"([^']+)", original.decode()):
        if not (REPO / name).is_file():
            raise RuntimeError('Missing original harness import: ' + name)
    harness = ROOT / 'integration.test.mts'
    harness.write_bytes(relocated)
    (EVIDENCE / 'integration.original.txt').write_bytes(original)
    (EVIDENCE / 'integration.relocated.txt').write_bytes(relocated)
    write('harness-identity.json', {'originalSha256': digest(BUNDLE / 'integration.original.txt'),
          'relocatedSha256': digest(harness), 'pathReplacements': 14,
          'byteReversible': True, 'assertionsChanged': False})
    return harness


def pg_env():
    env = ENV.copy()
    env.update(LIVE_PG_TESTS='1', TEST_DATABASE_URL='postgresql://postgres@localhost/postgres?' +
               urlencode({'host': str(ROOT / 'socket'), 'port': '55462'}))
    return env


def sql(name, text):
    checked(name, [str(PG / 'psql'), '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
                  '-h', str(ROOT / 'socket'), '-p', '55462', '-U', 'postgres',
                  '-d', 'postgres', '-c', text])
    return (EVIDENCE / (name + '.log')).read_text().strip()


def run():
    verify_sources()
    harness = relocate()
    if output(['node', '--version']) != 'v24.22.2':
        raise RuntimeError('Exact Node24.22.2 required')
    checked('pin-npm', ['npm', 'install', '--global', 'npm@11.8.0', '--ignore-scripts',
                        '--no-audit', '--no-fund'])
    if output(['npm', '--version']) != '11.8.0':
        raise RuntimeError('Exact npm11.8.0 required')
    write('toolchain.json', {'node': output(['node', '--version']),
                            'npm': output(['npm', '--version']),
                            'postgres': output([str(PG / 'pg_ctl'), '--version'])})
    if not output([str(PG / 'pg_ctl'), '--version']).startswith('pg_ctl (PostgreSQL) 16.'):
        raise RuntimeError('PostgreSQL16 required')
    checked('npm-ci', ['npm', 'ci'])
    failures = []
    for name, args in [('lint', ['npm', 'run', 'lint']),
                       ('typecheck', ['npm', 'run', 'typecheck']),
                       ('unit', ['npm', 'test']), ('build', ['npm', 'run', 'build'])]:
        if command(name, args) != 0:
            failures.append(name)
    (ROOT / 'socket').mkdir(mode=0o700)
    checked('pg-init', [str(PG / 'initdb'), '-D', str(ROOT / 'pgdata'), '-U', 'postgres',
                        '-A', 'trust', '--no-locale', '--encoding=UTF8'])
    checked('pg-start', [str(PG / 'pg_ctl'), '-D', str(ROOT / 'pgdata'), '-l',
                         str(EVIDENCE / 'pg-server.log'), '-o',
                         '-k ' + str(ROOT / 'socket') + " -p 55462 -c listen_addresses='' -c max_connections=100",
                         '-w', 'start'])
    identity = sql('pg-identity', "select current_setting('data_directory'),"
                   "current_setting('listen_addresses'),current_setting('port'),"
                   "current_setting('server_version_num');")
    fields = identity.split('|')
    if len(fields) != 4 or Path(fields[0]) != ROOT / 'pgdata' or fields[1] or fields[2] != '55462' or not (160000 <= int(fields[3]) < 170000):
        raise RuntimeError('Disposable PostgreSQL identity mismatch')
    focused = shlex.split((BUNDLE / 'focused-pg-command.txt').read_text())
    for name, args, count in [('integration', ['node', '--test', str(harness)], 6),
                               ('focused-pg', focused, 129)]:
        rc = command(name, args, env=pg_env())
        log = (EVIDENCE / (name + '.log')).read_text()
        # The original Node command is unchanged; accept spec or TAP summary syntax.
        def total(label):
            match = re.search(r'^(?:ℹ|#) ' + label + r' (\d+)\s*$', log, re.M)
            return int(match[1]) if match else None
        counts = {key: total(key) for key in ('tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo')}
        write(name + '-counts.json', counts)
        if rc != 0 or counts != {'tests': count, 'pass': count, 'fail': 0,
                                 'skipped': 0, 'cancelled': 0, 'todo': 0}:
            failures.append(name)
    verify_sources()
    write('run-result.json', {'failures': failures, 'runtimeDispatchAllowed': False})
    if failures:
        raise RuntimeError('Verification failures: ' + ', '.join(failures))


def finalize():
    errors = []
    data, socket = ROOT / 'pgdata', ROOT / 'socket'
    started = any(c['name'] == 'pg-start' and c['exitCode'] == 0 for c in COMMANDS)
    uncertain_stop = started and not (data / 'postmaster.pid').exists()
    if uncertain_stop:
        errors.append('Successful PG start without current PID; stop not independently confirmed')
    if data.exists():
        if (data / 'postmaster.pid').exists():
            try:
                remaining = sql('pg-owned-databases',
                                "select datname from pg_database where datname like 'aipc_pgtest_%';")
                if remaining:
                    errors.append('Test database inventory not empty')
            except Exception as exc:
                errors.append(str(exc))
            if command('pg-stop', [str(PG / 'pg_ctl'), '-D', str(data), '-m', 'fast', '-w', 'stop']) != 0:
                errors.append('PostgreSQL stop failed')
        if (data / 'postmaster.pid').exists():
            errors.append('Postmaster still present; owned data retained')
        elif not uncertain_stop:
            shutil.rmtree(data)
    if not data.exists() and socket.exists() and not uncertain_stop:
        shutil.rmtree(socket)
    result = EVIDENCE / 'run-result.json'
    if not result.exists():
        errors.append('Verification did not finish')
    elif json.loads(result.read_text())['failures']:
        errors.append('Verification gates failed')
    write('cleanup.json', {'errors': errors, 'dataAbsent': not data.exists(),
                           'socketAbsent': not socket.exists(), 'runtimeDispatchAllowed': False})
    files = sorted(f for f in EVIDENCE.rglob('*') if f.is_file() and f.name != 'ARTIFACTS.sha256')
    manifest = ''.join(digest(f) + '  ' + str(f.relative_to(EVIDENCE)) + '\n' for f in files)
    (EVIDENCE / 'ARTIFACTS.sha256').write_text(manifest)
    for row in manifest.splitlines():
        expected, name = row.split('  ', 1)
        if digest(EVIDENCE / name) != expected:
            raise RuntimeError('New evidence manifest verification failed')
    if errors:
        raise RuntimeError('; '.join(errors))


if __name__ == '__main__':
    if sys.platform != 'linux' or os.environ.get('GITHUB_ACTIONS') != 'true':
        raise SystemExit('GitHub Ubuntu runner only; no local Mac execution')
    ROOT = Path(os.environ['PAC_E01_ROOT']).resolve()
    if ROOT.parent != Path(os.environ['RUNNER_TEMP']).resolve() or not ROOT.name.startswith('pac-dev02-e01-'):
        raise SystemExit('Unsafe owned temporary directory')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    EVIDENCE = ROOT / 'evidence'
    EVIDENCE.mkdir(exist_ok=True)
    previous = EVIDENCE / 'commands.json'
    if previous.exists():
        COMMANDS = json.loads(previous.read_text())
    try:
        {'run': run, 'finalize': finalize}[sys.argv[1]]()
    except Exception as exc:
        (EVIDENCE / (sys.argv[1] + '-error.txt')).write_text(str(exc) + '\n')
        # finalize seals the error file too; run errors are sealed by always() finalize.
        if sys.argv[1] == 'finalize':
            files = sorted(f for f in EVIDENCE.iterdir() if f.is_file() and f.name != 'ARTIFACTS.sha256')
            (EVIDENCE / 'ARTIFACTS.sha256').write_text(''.join(
                digest(f) + '  ' + f.name + '\n' for f in files))
        raise SystemExit(str(exc))
