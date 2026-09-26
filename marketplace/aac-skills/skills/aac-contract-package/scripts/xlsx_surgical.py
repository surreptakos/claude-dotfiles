"""Surgical xlsx editor. Rewrites only the XML parts that must change and copies
every other zip member byte-for-byte, so styles, drawings, printer settings,
rich-text runs, metadata and external links survive untouched."""
import zipfile, re

def _esc(t):
    return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

# ---- row-deletion helpers (delete_rows) -----------------------------------
# An endpoint is (column-with-optional-$, row-$-or-'', row); an area is a list
# of one endpoint (single cell) or two (a range).
_EP = r'(\$?[A-Z]{1,3})(\$?)(\d+)'

def _parse_area(text):
    m = re.fullmatch(_EP + r'(?::' + _EP + r')?', text)
    if not m:
        raise ValueError('cannot parse cell area %r' % text)
    eps = [(m.group(1), m.group(2), int(m.group(3)))]
    if m.group(4):
        eps.append((m.group(4), m.group(5), int(m.group(6))))
    return eps

def _fmt_area(eps):
    return ':'.join('%s%s%d' % ep for ep in eps)

def _shift_area(eps, first, last, count):
    """Move an area the way Excel does when rows first..last are deleted.
    Returns None when the area lies wholly inside the deleted rows."""
    if len(eps) == 1:
        c, d, r = eps[0]
        if first <= r <= last:
            return None
        return [(c, d, r - count if r > last else r)]
    (c1, d1, r1), (c2, d2, r2) = eps
    n1 = r1 if r1 < first else (first if r1 <= last else r1 - count)
    n2 = r2 if r2 < first else (first - 1 if r2 <= last else r2 - count)
    if n2 < n1:
        return None
    return [(c1, d1, n1), (c2, d2, n2)]

_UNXML = (('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'), ('&apos;', "'"), ('&amp;', '&'))

def _sheet_of(prefix):
    """Sheet name a formula prefix (``'A &amp; B'!`` or ``Sheet1!``) names,
    XML-unescaped, or None for an external-workbook reference."""
    n = prefix[:-1]
    if n.startswith("'"):
        n = n[1:-1].replace("''", "'")
    for a, b in _UNXML:
        n = n.replace(a, b)
    return None if n.startswith('[') else n

_REF = re.compile(r"(?<![\w.$\]!'])"
                  r"(?P<pre>(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?"
                  r"(?P<area>" + _EP + r"(?::" + _EP + r")?)"
                  r"(?![\w(!])")

def _shift_formula(text, sheet, first, last, count, own):
    """Repoint the references in one formula (XML-escaped text) that target
    ``sheet``. ``own`` says unqualified references mean ``sheet``. String
    literals are left alone. A reference that would lose its target raises
    rather than becoming #REF!."""
    parts = re.split(r'(&quot;.*?&quot;|"[^"]*")', text)
    for k in range(0, len(parts), 2):
        def sub(m):
            pre = m.group('pre')
            target = _sheet_of(pre) if pre else (sheet if own else None)
            if target != sheet:
                return m.group(0)
            moved = _shift_area(_parse_area(m.group('area')), first, last, count)
            if moved is None:
                raise ValueError('formula %r points into the deleted rows; refusing' % text)
            return (pre or '') + _fmt_area(moved)
        parts[k] = _REF.sub(sub, parts[k])
    return ''.join(parts)

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

    def set_row_hidden(self, sheet, row_num, hidden=True):
        """Toggle a row's hidden attribute in place.

        Only the opening ``<row ...>`` tag is rewritten; the row's cells (if
        any) and the closing ``</row>`` (if any) are left byte-for-byte alone.
        Handles both cell-bearing rows (``<row ...>...</row>``) and empty
        self-closing rows (``<row .../>``) — the latter is the shape that
        motivated issue 97. Falling through to the open-form regex on a
        self-closing row would capture the trailing ``/`` into the attribute
        span and emit malformed XML on rewrite; the two-shot match below is
        exactly how ``set_inline_text`` handles the same ambiguity for cells.

        Idempotent: setting hidden=True on a row that already carries
        ``hidden="1"`` (or False on one that does not) emits an equivalent
        opening tag. Any existing ``hidden="..."`` attribute is stripped
        before the fresh one is written, so the attribute never duplicates.
        """
        name = self.sheets[sheet]
        sh = self.parts[name].decode('utf8')
        # Try the self-closing form first. Non-greedy ``[^>]*?`` up to
        # ``/>`` keeps the trailing slash OUT of the captured attributes;
        # if we let the open-form regex win on a self-closing row it would
        # capture the ``/`` into ``attrs`` and produce ``<row ... / hidden=...>``.
        m = re.search(r'<row r="%d"([^>]*?)/>' % row_num, sh)
        self_closing = m is not None
        if m is None:
            m = re.search(r'<row r="%d"([^>]*)>' % row_num, sh)
        if m is None:
            raise KeyError('row %d not found' % row_num)
        attrs = m.group(1)
        # Drop any pre-existing hidden="..." so a repeat call cannot double it.
        new_attrs = re.sub(r'\s+hidden="[^"]*"', '', attrs)
        if hidden:
            # Prepend rather than append: keeps the attribute close to r="N"
            # for readability and never lands after a stray whitespace tail.
            new_attrs = ' hidden="1"' + new_attrs
        if self_closing:
            replacement = '<row r="%d"%s/>' % (row_num, new_attrs)
        else:
            replacement = '<row r="%d"%s>' % (row_num, new_attrs)
        sh = sh[:m.start()] + replacement + sh[m.end():]
        self.parts[name] = sh.encode('utf8')
        self.dirty.add(name)

    def copy_row_styles(self, sheet, src_row, dst_row):
        """Give every cell of ``dst_row`` the style index (``s``) of the
        same-column cell in ``src_row``; values, types and every other
        attribute of the destination cells stay as they are.

        This is how a repeated block row (a second ``System:`` line inside
        the equipment fill region, a subgroup label inside the services
        region) takes the look of the template's own row for that role
        without inserting or reindexing anything. Only the ``s`` attribute
        of the destination row's cells is rewritten in the sheet part;
        no other zip member changes. Destination cells with no counterpart
        in the source row are left alone. Raises KeyError when either row
        is missing or the destination row carries no cells to style.
        """
        name = self.sheets[sheet]
        sh = self.parts[name].decode('utf8')
        # Cell-bearing rows only: a self-closing <row .../> has no cells, so
        # the source has nothing to copy and the destination nothing to
        # style. Match the self-closing form first so its trailing slash is
        # never mistaken for an attribute (same discipline as set_row_hidden).
        def span(n):
            if re.search(r'<row r="%d"[^>]*?/>' % n, sh):
                raise KeyError('row %d has no cells' % n)
            m = re.search(r'<row r="%d"[^>]*>.*?</row>' % n, sh, re.S)
            if m is None:
                raise KeyError('row %d not found' % n)
            return m
        src = span(src_row)
        styles = {}
        for c in re.finditer(r'<c r="([A-Z]+)%d"([^>]*?)/?>' % src_row, src.group(0)):
            s = re.search(r'\bs="([^"]*)"', c.group(2))
            if s:
                styles[c.group(1)] = s.group(1)
        dst = span(dst_row)

        def restyle(m):
            col, attrs, close = m.group(1), m.group(2), m.group(3)
            if col not in styles:
                return m.group(0)
            attrs = re.sub(r'\s+s="[^"]*"', '', attrs)
            return '<c r="%s%d" s="%s"%s%s>' % (col, dst_row, styles[col], attrs, close)
        body = re.sub(r'<c r="([A-Z]+)%d"([^>]*?)(/?)>' % dst_row, restyle, dst.group(0))
        sh = sh[:dst.start()] + body + sh[dst.end():]
        self.parts[name] = sh.encode('utf8')
        self.dirty.add(name)

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

    def _put(self, name, text):
        """Store a rewritten XML part, marking it dirty only when its bytes
        actually changed, so an untouched member is never reported as edited."""
        data = text.encode('utf8')
        if data != self.parts[name]:
            self.parts[name] = data
            self.dirty.add(name)

    def delete_rows(self, sheet, first, count=1):
        """Delete ``count`` empty rows starting at ``first`` and move everything
        below them up, the way Excel's Delete Row does. This is how a merged
        text block (the Clarifications and Exclusions block, the SOW) gives
        back the surplus rows after an edit shortened its text (issue 304).

        Repointed: the sheet's rows and cells, ``<dimension>``, merge ranges
        (a merge that contains the deleted rows shrinks, one wholly inside
        them is dropped), hyperlinks, data validations, conditional formats,
        view/selection anchors, row breaks, ``<f ref>`` spans, every formula
        in the workbook that points at this sheet, defined names (the print
        area), ``calcChain.xml`` entries for this sheet and the anchors in
        this sheet's drawing. Each of those parts is rewritten only when a
        reference in it actually moved; every other zip member is copied
        byte-for-byte by ``save``.

        Refuses (raises, nothing is changed) rather than guessing when:
        a deleted row holds a value, formula or inline string; a deleted row
        is the top row of a merge that continues below it; a merge, hyperlink,
        validation, conditional format, drawing anchor or single-cell formula
        reference would lose its target; or the sheet carries comments,
        tables or the workbook carries charts, whose references this editor
        does not rewrite.
        """
        if count < 1 or first < 1:
            raise ValueError('first and count must be >= 1')
        last = first + count - 1
        name = self.sheets[sheet]
        rels_name = name.replace('worksheets/', 'worksheets/_rels/') + '.rels'
        rels = self.parts.get(rels_name, b'').decode('utf8')
        for kind in ('/comments"', '/table"'):
            if kind in rels:
                raise NotImplementedError('sheet has %s parts; refusing' % kind.strip('/"'))
        if any(n.startswith('xl/charts/') for n in self.parts):
            raise NotImplementedError('workbook has charts; refusing')

        new = {}  # part name -> rewritten text; committed only if every step succeeds

        # ---- the sheet itself -------------------------------------------
        sh = self.parts[name].decode('utf8')
        row_pat = re.compile(r'<row r="(\d+)"[^>]*?(?:/>|>.*?</row>)', re.S)

        def fix_row(m):
            r = int(m.group(1))
            if r < first:
                return m.group(0)
            body = m.group(0)
            if r <= last:
                if re.search(r'<v>|<v |<f[ >]|<is>', body):
                    raise ValueError('row %d holds content; refusing to delete it' % r)
                return ''
            r2 = r - count
            body = re.sub(r'^<row r="%d"' % r, '<row r="%d"' % r2, body)
            return re.sub(r'<c r="([A-Z]+)%d"' % r, lambda c: '<c r="%s%d"' % (c.group(1), r2), body)
        sd = re.search(r'<sheetData>.*?</sheetData>', sh, re.S)
        if sd:
            sh = sh[:sd.start()] + row_pat.sub(fix_row, sd.group(0)) + sh[sd.end():]

        # Formulas inside this sheet: unqualified refs are this sheet's.
        sh = self._shift_formula_elements(sh, sheet, first, last, count, own=True)
        # <f ref="..."> spans of shared/array formulas.
        sh = re.sub(r'(<f\b[^>]*\bref=")([^"]+)(")',
                    lambda m: m.group(1) + self._shift_sqref(m.group(2), first, last, count, 'formula span') + m.group(3), sh)

        def attr(tag, att, what, clamp=False):
            nonlocal sh
            sh = re.sub(r'(<%s\b[^>]*?\b%s=")([^"]+)(")' % (tag, att),
                        lambda m: m.group(1) + self._shift_sqref(m.group(2), first, last, count, what, clamp) + m.group(3), sh)
        attr('dimension', 'ref', 'dimension', clamp=True)
        attr('hyperlink', 'ref', 'hyperlink')
        attr('dataValidation', 'sqref', 'data validation')
        attr('conditionalFormatting', 'sqref', 'conditional format')
        attr('ignoredError', 'sqref', 'ignored-error range', clamp=True)
        attr('selection', 'sqref', 'selection', clamp=True)
        attr('selection', 'activeCell', 'selection', clamp=True)
        attr('sheetView', 'topLeftCell', 'view', clamp=True)
        attr('pane', 'topLeftCell', 'view', clamp=True)

        def fix_brk(m):
            b = int(m.group(2))
            if first <= b <= last:
                raise ValueError('row break at row %d would be deleted; refusing' % b)
            return m.group(1) + str(b - count if b > last else b) + m.group(3)
        rb = re.search(r'<rowBreaks\b.*?</rowBreaks>', sh, re.S)
        if rb:
            sh = sh[:rb.start()] + re.sub(r'(<brk\b[^>]*?\bid=")(\d+)(")', fix_brk, rb.group(0)) + sh[rb.end():]

        # Merges: shrink, move, or drop the ones the deletion swallows whole.
        def fix_merges(block):
            kept = []
            for m in re.finditer(r'<mergeCell ref="([^"]+)"\s*/>', block):
                a = _parse_area(m.group(1))
                r1, r2 = a[0][2], a[-1][2]
                if first <= r1 <= last and r2 > last:
                    raise ValueError('rows %d-%d include the top row of merge %s; refusing'
                                     % (first, last, m.group(1)))
                moved = _shift_area(a, first, last, count)
                if moved is None:
                    continue
                if len(moved) == 1 or moved[0][::2] == moved[1][::2]:
                    continue  # collapsed to one cell: no longer a merge
                kept.append('<mergeCell ref="%s"/>' % _fmt_area(moved))
            if not kept:
                return ''
            head = re.match(r'<mergeCells\b[^>]*>', block).group(0)
            head = re.sub(r'\bcount="\d+"', 'count="%d"' % len(kept), head)
            return head + ''.join(kept) + '</mergeCells>'
        mc = re.search(r'<mergeCells\b[^>]*>.*?</mergeCells>', sh, re.S)
        if mc:
            sh = sh[:mc.start()] + fix_merges(mc.group(0)) + sh[mc.end():]
        new[name] = sh

        # ---- formulas on every other sheet that point at this one -------
        for other, part in self.sheets.items():
            if part == name:
                continue
            new[part] = self._shift_formula_elements(
                self.parts[part].decode('utf8'), sheet, first, last, count, own=False)

        # ---- defined names (print area, print titles, named ranges) -----
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        new['xl/workbook.xml'] = re.sub(
            r'(<definedName\b[^>]*>)(.*?)(</definedName>)',
            lambda m: m.group(1) + _shift_formula(m.group(2), sheet, first, last, count, False) + m.group(3),
            wb, flags=re.S)

        # ---- calcChain: entries carry the sheetId; omitted i inherits ---
        sid = None
        for sm in re.finditer(r'<sheet\s+([^>]*?)/?>', wb):
            nm = re.search(r'\bname="([^"]+)"', sm.group(1))
            if nm and nm.group(1).replace('&amp;', '&') == sheet:
                sid = re.search(r'\bsheetId="(\d+)"', sm.group(1)).group(1)
        if 'xl/calcChain.xml' in self.parts and sid is not None:
            cur = [None]
            def fix_cc(m):
                attrs = m.group(1)
                i = re.search(r'\bi="(\d+)"', attrs)
                if i:
                    cur[0] = i.group(1)
                ref = re.search(r'\br="([A-Z]+)(\d+)"', attrs)
                if cur[0] != sid or not ref:
                    return m.group(0)
                col, r = ref.group(1), int(ref.group(2))
                if first <= r <= last:
                    raise ValueError('calcChain names %s%d in the deleted rows' % (col, r))
                if r < first:
                    return m.group(0)
                return m.group(0).replace(ref.group(0), 'r="%s%d"' % (col, r - count), 1)
            cc = self.parts['xl/calcChain.xml'].decode('utf8')
            new['xl/calcChain.xml'] = re.sub(r'<c\b([^>]*?)/>', fix_cc, cc)

        # ---- drawing anchors (0-based rows) -----------------------------
        for rel in re.finditer(r'<Relationship\s+([^>]*?)/?>', rels):
            a = rel.group(1)
            if '/drawing"' not in a:
                continue
            tgt = re.search(r'\bTarget="([^"]+)"', a).group(1)
            dname = tgt.lstrip('/') if tgt.startswith('/') else 'xl/' + tgt.replace('../', '')
            def fix_anchor(m):
                r = int(m.group(2)) + 1
                if first <= r <= last:
                    raise ValueError('a drawing is anchored in row %d, which would be deleted' % r)
                return m.group(1) + str(r - 1 - count if r > last else r - 1) + m.group(3)
            new[dname] = re.sub(r'(<xdr:(?:from|to)>(?:(?!</xdr:(?:from|to)>).)*?<xdr:row>)(\d+)(</xdr:row>)',
                                fix_anchor, self.parts[dname].decode('utf8'), flags=re.S)

        for part, text in new.items():
            self._put(part, text)

    def _shift_formula_elements(self, xml, sheet, first, last, count, own):
        return re.sub(r'(<(f|formula|formula1|formula2)\b[^>]*>)(.*?)(</\2>)',
                      lambda m: m.group(1) + _shift_formula(m.group(3), sheet, first, last, count, own) + m.group(4),
                      xml, flags=re.S)

    def _shift_sqref(self, sqref, first, last, count, what, clamp=False):
        out = []
        for part in sqref.split():
            a = _parse_area(part)
            moved = _shift_area(a, first, last, count)
            if moved is None:
                if not clamp:
                    raise ValueError('%s %s lies wholly in the deleted rows; refusing' % (what, part))
                moved = [(c, d, first) for c, d, _ in a]
            out.append(_fmt_area(moved))
        return ' '.join(out)

    def set_sheet_hidden(self, name, hidden=True):
        """Hide (or show) a worksheet tab. Rewrites only the ``state``
        attribute of that sheet's ``<sheet>`` element in xl/workbook.xml;
        every worksheet part stays byte-for-byte as it was.

        Idempotent: any existing ``state="..."`` is dropped before the new
        one is written, and showing a sheet removes the attribute (visible
        is the OOXML default). Refuses to hide the workbook's active tab
        (``<workbookView activeTab>``, default 0), since Excel would open on
        a hidden sheet."""
        if name not in self.sheets:
            raise KeyError('no sheet named %r' % name)
        wb = self.parts['xl/workbook.xml'].decode('utf8')
        pat = re.compile(r'(<sheet\s+)([^>]*?)(\s*/?>)')
        esc = _esc(name)
        idx, found = [0], [None]

        def _sub(m):
            attrs = m.group(2)
            name_m = re.search(r'\bname="([^"]+)"', attrs)
            i = idx[0]; idx[0] += 1
            if not name_m or name_m.group(1) != esc:
                return m.group(0)
            found[0] = i
            attrs = re.sub(r'\s+state="[^"]*"', '', attrs)
            if hidden:
                attrs += ' state="hidden"'
            return m.group(1) + attrs + m.group(3)
        wb2 = pat.sub(_sub, wb)
        if found[0] is None:
            raise RuntimeError('could not locate <sheet name=%r> in workbook.xml' % name)
        if hidden:
            at = re.search(r'<workbookView\b[^>]*?\bactiveTab="(\d+)"', wb)
            if found[0] == (int(at.group(1)) if at else 0):
                raise RuntimeError('%r is the active tab; refusing to hide it' % name)
        if wb2 != wb:
            self.parts['xl/workbook.xml'] = wb2.encode('utf8')
            self.dirty.add('xl/workbook.xml')

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
