"""Path resolution for the AAC contract package scripts.

Two kinds of thing, two homes, no configuration:

* **Standards and this code** ship inside the skill. Governing documents are in
  `../references/` relative to this file. They travel with the skill, so there
  is exactly one copy and it cannot drift from the version of the code that
  reads it.
* **Customer data** lives on the jobs drive and is never moved. The jobs root is
  derived from the job folder you name, so `P:\\Jobs\\Acme_123 Main_Fire Alarm`
  gives a jobs root of `P:\\Jobs`. Nothing is hardcoded to a drive letter.

Templates, agreement forms and the backup folder are found relative to the jobs
root, with a P: fallback for the agreements library.

    import aac_paths
    P = aac_paths.for_job(r'P:\\Jobs\\Acme_123 Main_Fire Alarm')
    P.schedule_template     # the blank workbook to copy
    P.to_delete             # where backups go
    aac_paths.CLARIFICATIONS  # the bullet library, inside the skill

Run `python aac_paths.py "<job folder>"` to print what resolved.
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKILL_ROOT = os.path.dirname(HERE)
REFERENCES = os.path.join(SKILL_ROOT, 'references')
CLARIFICATIONS = os.path.join(REFERENCES, 'clarifications.json')

TEMPLATE_FOLDER_NAME = '_SALES .TEMPLATE FOLDER (DO NOT OVERWRITE THIS)'
SCHEDULE_TEMPLATE_NAME = 'Equip & Svc Schedule Template.xlsx'
AGREEMENTS_NAME = 'New Agreements 8-22-19'


def reference(name):
    """Path to a governing document bundled with the skill."""
    return os.path.join(REFERENCES, name)


class Roots:
    def __init__(self, jobs_root):
        self.jobs_root = os.path.abspath(jobs_root)
        self.templates_root = os.path.join(self.jobs_root, TEMPLATE_FOLDER_NAME)
        self.schedule_template = os.path.join(self.templates_root, SCHEDULE_TEMPLATE_NAME)
        self.to_delete = os.path.join(self.jobs_root, '_to_delete')
        self.agreements_root = self._find_agreements()
        self.training_root = self._find_sibling('Contract Training')

    def _siblings(self):
        parent = os.path.dirname(self.jobs_root)
        return parent, os.path.dirname(parent)

    def _find_agreements(self):
        parent, grand = self._siblings()
        for c in (os.path.join(parent, AGREEMENTS_NAME),
                  os.path.join(parent, 'Agreements', AGREEMENTS_NAME),
                  os.path.join(grand, 'Agreements', AGREEMENTS_NAME),
                  os.path.join('P:' + os.sep, 'Agreements', AGREEMENTS_NAME)):
            if os.path.isdir(c):
                return c
        return os.path.join(parent, 'Agreements', AGREEMENTS_NAME)

    def _find_sibling(self, name):
        parent, grand = self._siblings()
        for c in (os.path.join(parent, name), os.path.join(grand, name),
                  os.path.join('P:' + os.sep, name)):
            if os.path.isdir(c):
                return c
        return os.path.join(parent, name)

    def require(self, *names):
        """Fail with the resolved paths rather than a FileNotFoundError three
        frames deep, and say what the resolution was based on."""
        missing = [(n, getattr(self, n)) for n in names
                   if not getattr(self, n) or not os.path.exists(getattr(self, n))]
        if missing:
            lines = '\n'.join(f'  {n} -> {v}' for n, v in missing)
            raise SystemExit(
                f'cannot find:\n{lines}\n\n'
                f'jobs root was derived as: {self.jobs_root}\n'
                f'If that is wrong, pass the job folder path, not a parent or a subfolder.')

    def report(self):
        rows = [('jobs_root', self.jobs_root), ('templates_root', self.templates_root),
                ('schedule_template', self.schedule_template), ('to_delete', self.to_delete),
                ('agreements_root', self.agreements_root), ('training_root', self.training_root)]
        rows += [('references (in skill)', REFERENCES), ('clarifications', CLARIFICATIONS)]
        w = max(len(k) for k, _ in rows)
        ok = True
        for k, v in rows:
            e = os.path.exists(v)
            ok = ok and e
            print(f'{k:<{w}}  {"OK  " if e else "MISS"}  {v}')
        print()
        print('all paths resolve' if ok else 'some paths missing')
        return ok


def for_job(job_folder):
    """Roots derived from a job folder: its parent is the jobs root."""
    job = os.path.abspath(str(job_folder).rstrip('\\/'))
    return Roots(os.path.dirname(job))


def for_root(jobs_root):
    """Roots when the jobs drive itself is named, as for a portfolio sweep."""
    return Roots(jobs_root)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        print('skill root :', SKILL_ROOT)
        print('references :', REFERENCES,
              '(OK)' if os.path.isdir(REFERENCES) else '(MISSING)')
        sys.exit(0)
    sys.exit(0 if for_job(sys.argv[1]).report() else 1)
