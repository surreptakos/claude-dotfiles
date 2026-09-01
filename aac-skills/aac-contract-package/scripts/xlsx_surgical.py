"""Surgical xlsx editor. Rewrites only the XML parts that must change and copies
every other zip member byte-for-byte, so styles, drawings, printer settings,
rich-text runs, metadata and external links survive untouched."""
import zipfile, re

def _esc(t):
    return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

class Workbook:
    def __init__(self, path):
        # Read every zip member up front, then close the handle. The reader
        # only ever consults ``self.parts``/``self.infos``/``self.order``
        # from here on; leaving the ZipFile open blocks a later os.replace
        # onto the same path on Windows (PermissionError WinError 5), which
        # is how build_package.py commits the edited workbook.
        with zipfile.ZipFile(path) as z:
            self.parts = {n: z.read(n) for n in z.namelist()}
            self.infos = {i.filename: i for i in z.infolist()}
            self.order = z.namelist()
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        rels = self.parts['xl/_rels/workbook.xml.rels'].decode('utf8')
        # <Relationship> attributes may appear in any order (OOXML makes no
        # ordering guarantee). Openpyxl emits ``Type Target Id``; Excel emits
        # ``Id Type Target``. Grab each attribute independently rather than
        # pinning a shape.
        rid = {}
        # ``[^>]*?`` (lazy) rather than ``[^/>]*``: attribute values can
        # contain ``/`` (Type URLs do), so excluding ``/`` from the class
        # would stop at the first ``http://`` slash and never reach the
        # closing tag.
        for rel in re.finditer(r'<Relationship\s+([^>]*?)/?>', rels):
            attrs = rel.group(1)
            id_m = re.search(r'\bId="([^"]+)"', attrs)
            tgt_m = re.search(r'\bTarget="([^"]+)"', attrs)
            if id_m and tgt_m:
                rid[id_m.group(1)] = tgt_m.group(1)
        self.sheets = {}
        # Same order-independence for <sheet>: openpyxl emits ``xmlns:r``
        # before ``name``; Excel emits ``name`` first. Extract name and
        # r:id from whichever position they take.
        for sh in re.finditer(r'<sheet\s+([^>]*?)/?>', wb):
            attrs = sh.group(1)
            name_m = re.search(r'\bname="([^"]+)"', attrs)
            rid_m = re.search(r'\br:id="([^"]+)"', attrs)
            if not (name_m and rid_m):
                continue
            tgt = rid[rid_m.group(1)]
            # Targets can be absolute (leading '/' means from the package
            # root, e.g. '/xl/worksheets/sheet1.xml') or relative to
            # xl/_rels/workbook.xml.rels (e.g. 'worksheets/sheet1.xml').
            # Both must resolve to the same zip path.
            if tgt.startswith('/'):
                resolved = tgt.lstrip('/')
            else:
                resolved = 'xl/' + tgt.replace('../', '')
            self.sheets[name_m.group(1).replace('&amp;', '&')] = resolved
        self.ss = self.parts.get('xl/sharedStrings.xml', b'').decode('utf8')
        self.dirty = set()

    def _sst_index(self, sheet, ref):
        sh = self.parts[self.sheets[sheet]].decode('utf8')
        m = re.search(r'<c r="%s"[^>]*t="s"[^>]*><v>(\d+)</v></c>' % ref, sh)
        if not m: raise KeyError('%s is not a shared-string cell' % ref)
        return int(m.group(1))

    def _si_span(self, idx):
        n = 0
        for m in re.finditer(r'<si>.*?</si>', self.ss, re.S):
            if n == idx: return m.start(), m.end()
            n += 1
        raise IndexError(idx)

    def _refcount(self, idx):
        return sum(len(re.findall(r't="s"[^>]*><v>%d</v>' % idx, self.parts[n].decode('utf8')))
                   for n in self.sheets.values())

    def set_text(self, sheet, ref, text):
        idx = self._sst_index(sheet, ref)
        if self._refcount(idx) != 1: raise RuntimeError('si[%d] shared; refusing' % idx)
        a, b = self._si_span(idx)
        if '<r>' in self.ss[a:b]: raise RuntimeError('si[%d] is rich text; use set_runs' % idx)
        self.ss = self.ss[:a] + '<si><t xml:space="preserve">%s</t></si>' % _esc(text) + self.ss[b:]
        self.dirty.add('xl/sharedStrings.xml')

    def runs(self, sheet, ref):
        a, b = self._si_span(self._sst_index(sheet, ref))
        return [re.search(r'<t[^>]*>(.*?)</t>', r, re.S).group(1)
                for r in re.findall(r'<r>.*?</r>', self.ss[a:b], re.S)]

    def set_runs(self, sheet, ref, updates):
        idx = self._sst_index(sheet, ref)
        if self._refcount(idx) != 1: raise RuntimeError('si[%d] shared; refusing' % idx)
        a, b = self._si_span(idx); si = self.ss[a:b]
        out, n, cur = [], 0, 0
        for m in re.finditer(r'<r>.*?</r>', si, re.S):
            out.append(si[cur:m.start()]); r = m.group(0)
            if n in updates:
                r = re.sub(r'(<t[^>]*>)(.*?)(</t>)',
                           lambda mm: '<t xml:space="preserve">' + _esc(updates[n]) + '</t>',
                           r, count=1, flags=re.S)
            out.append(r); cur = m.end(); n += 1
        out.append(si[cur:])
        self.ss = self.ss[:a] + ''.join(out) + self.ss[b:]
        self.dirty.add('xl/sharedStrings.xml')

    def set_number(self, sheet, ref, value):
        name = self.sheets[sheet]; sh = self.parts[name].decode('utf8')
        m = re.search(r'<c r="%s"([^>]*)>.*?</c>' % ref, sh, re.S)
        if not m: raise KeyError(ref)
        attrs = re.sub(r'\s*t="[^"]*"', '', m.group(1))
        sh = sh[:m.start()] + '<c r="%s"%s><v>%s</v></c>' % (ref, attrs, value) + sh[m.end():]
        self.parts[name] = sh.encode('utf8'); self.dirty.add(name)
        if 'xl/calcChain.xml' in self.parts:
            cc = self.parts['xl/calcChain.xml'].decode('utf8')
            cc2 = re.sub(r'<c r="%s"[^>]*/>' % ref, '', cc, count=1)
            if cc2 != cc:
                self.parts['xl/calcChain.xml'] = cc2.encode('utf8'); self.dirty.add('xl/calcChain.xml')
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        if 'fullCalcOnLoad' not in wb:
            wb = re.sub(r'<calcPr([^>]*?)/>', r'<calcPr\1 fullCalcOnLoad="1"/>', wb, count=1)
            self.parts['xl/workbook.xml'] = wb.encode('utf8'); self.dirty.add('xl/workbook.xml')

    def set_formula(self, sheet, ref, formula):
        """Replace a cell's formula, keeping its style. Drops the cached value and
        forces Excel to recalculate on open."""
        name = self.sheets[sheet]; sh = self.parts[name].decode('utf8')
        m = re.search(r'<c r="%s"([^>]*)>.*?</c>' % ref, sh, re.S) or \
            re.search(r'<c r="%s"([^>]*)/>' % ref, sh)
        if not m: raise KeyError(ref)
        attrs = re.sub(r'\s*t="[^"]*"', '', m.group(1)).rstrip('/')
        sh = sh[:m.start()] + '<c r="%s"%s><f>%s</f></c>' % (ref, attrs, _esc(formula)) + sh[m.end():]
        self.parts[name] = sh.encode('utf8'); self.dirty.add(name)
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        if 'fullCalcOnLoad' not in wb:
            wb = re.sub(r'<calcPr([^>]*?)/>', r'<calcPr\1 fullCalcOnLoad="1"/>', wb, count=1)
            self.parts['xl/workbook.xml'] = wb.encode('utf8'); self.dirty.add('xl/workbook.xml')

    def set_inline_text(self, sheet, ref, text):
        """Write text into a cell as an inline string, keeping its style. Works on
        empty self-closing cells and never touches sharedStrings, so a shared label
        cannot be corrupted. Pass '' to clear a cell."""
        name = self.sheets[sheet]; sh = self.parts[name].decode('utf8')
        m = re.search(r'<c r="%s"([^>]*?)/>' % ref, sh) or \
            re.search(r'<c r="%s"([^>]*)>.*?</c>' % ref, sh, re.S)
        if not m: raise KeyError(ref)
        attrs = re.sub(r'\s*t="[^"]*"', '', m.group(1)).rstrip('/')
        if text == '':
            cell = '<c r="%s"%s/>' % (ref, attrs)
        else:
            cell = '<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>' % (
                ref, attrs, _esc(text))
        sh = sh[:m.start()] + cell + sh[m.end():]
        self.parts[name] = sh.encode('utf8'); self.dirty.add(name)

    def set_num(self, sheet, ref, value):
        """set_number that also handles empty self-closing cells."""
        name = self.sheets[sheet]; sh = self.parts[name].decode('utf8')
        m = re.search(r'<c r="%s"([^>]*?)/>' % ref, sh)
        if m:
            attrs = m.group(1).rstrip('/')
            sh = sh[:m.start()] + '<c r="%s"%s><v>%s</v></c>' % (ref, attrs, value) + sh[m.end():]
            self.parts[name] = sh.encode('utf8'); self.dirty.add(name)
            return
        self.set_number(sheet, ref, value)

    def rename_sheet(self, old_name, new_name):
        """Rename a sheet tab. Rewrites only the <sheet name="..."> attribute in
        xl/workbook.xml; the sheet's own XML file has no self-referential tab
        name, so nothing else needs to change. External references to the tab
        (formulas like 'Sheet1'!A1 in OTHER workbooks) are not our concern —
        this is the same behaviour Excel exhibits when a user renames a tab.

        Idempotent: renaming to the current name is a no-op. Raises if the
        old name is not present or the new name is already taken by a
        different sheet."""
        if old_name == new_name:
            return
        if old_name not in self.sheets:
            raise KeyError('no sheet named %r' % old_name)
        if new_name in self.sheets:
            raise KeyError('destination name %r already in use' % new_name)
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        # Match the sheet element that has this exact name= attribute value,
        # allowing name= to appear anywhere in the attribute list (Excel and
        # openpyxl differ on ordering; same order-independence discipline as
        # __init__ uses).
        esc_old = _esc(old_name)
        esc_new = _esc(new_name)
        pat = re.compile(r'(<sheet\s+)([^>]*?)(/?>)')
        found = [False]
        def _sub(m):
            attrs = m.group(2)
            name_m = re.search(r'\bname="([^"]+)"', attrs)
            if not name_m or name_m.group(1) != esc_old:
                return m.group(0)
            found[0] = True
            new_attrs = attrs[:name_m.start()] + 'name="' + esc_new + '"' + attrs[name_m.end():]
            return m.group(1) + new_attrs + m.group(3)
        wb2 = pat.sub(_sub, wb)
        if not found[0]:
            raise RuntimeError('could not locate <sheet name=%r> in workbook.xml' % old_name)
        self.parts['xl/workbook.xml'] = wb2.encode('utf8')
        self.dirty.add('xl/workbook.xml')
        # Keep the in-memory sheet map coherent so later reads work.
        self.sheets[new_name] = self.sheets.pop(old_name)

    def save(self, out):
        if 'xl/sharedStrings.xml' in self.dirty:
            self.parts['xl/sharedStrings.xml'] = self.ss.encode('utf8')
        with zipfile.ZipFile(out, 'w') as w:
            for n in self.order:
                i = self.infos[n]
                zi = zipfile.ZipInfo(n, date_time=i.date_time)
                zi.compress_type = i.compress_type; zi.external_attr = i.external_attr
                zi.internal_attr = i.internal_attr; zi.create_system = i.create_system
                w.writestr(zi, self.parts[n])
