# AAC-WR-001 coverage: how each of the 170 rules is checked

Companion to `wr001-lint.js`. Every rule has one row. **Pattern** means the linter decides it by regex, per line or per document; **Jev** means a TypeSafe Jev judgment call on one unit (a sentence, a paragraph, a term in context, or the whole document), warning only; **Reader** means the rule needs the evidence, the audience, the facts or the sense of the text, so the release check (Rule 166) decides it; **Layout** means it lives in the rendered Word or PDF document, not in the text the linter reads.

Maintenance rule (Dan, September 29, 2026): a revision that adds or changes a rule lands with its check in `wr001-lint.js`, or with its row here saying why no pattern can decide it, in the same PR. `tools/wr001-lint-coverage.test.js` fails when this table and the linter disagree, when a rule number is missing or repeated, or when the count line below is stale.

Counts: Pattern 55, Pattern and Jev 3, Jev 4, Reader 86, Layout 22.

Table 1. Rule coverage

| Rule | Title | Checked by | What the check sees, or why a reader decides |
|---|---|---|---|
| 1 | Purpose | Reader | governing text, not a rule on prose |
| 2 | Order of authority | Reader | needs the document's authority chain |
| 3 | Mandatory terms used in this standard | Reader | defines terms |
| 4 | General writing standard | Reader | the whole document's fitness for its reader |
| 5 | State the main point early | Jev | Jev reads the opening paragraph for background before the point |
| 6 | Identify the actor | Jev | Jev reads each sentence for passive voice that hides the actor |
| 7 | Assign actions precisely | Reader | whether who, what, where, when and condition are answered needs the facts |
| 8 | Match certainty to the evidence | Reader | certainty against the evidence; needs the evidence |
| 9 | Plain language | Pattern | the listed inflated words and phrases (utilize, prior to, subsequent to, commence, due to the fact that) |
| 10 | Avoid filler | Pattern and Jev | the seven filler openers the rule names, plus Please note that; Jev reads for the rest |
| 11 | Paragraphs | Reader | paragraph focus needs the sense of the text |
| 12 | Sentence length | Reader | sentence length by clarity, not by count |
| 13 | Contractions | Reader | contractions are allowed or not by document type and purpose |
| 14 | Requirements, commitments, and permission | Pattern | any 'shall' (Rule 139 keeps it in contracts, so a warning) |
| 15 | Sentence spacing | Pattern | two spaces after sentence punctuation |
| 16 | Serial comma | Pattern | three or more comma-separated items with no comma before the last and/or |
| 17 | Commas between independent clauses | Reader | a comma before a conjunction needs the clause structure |
| 18 | Introductory elements | Reader | introductory-element commas need the clause structure |
| 19 | Nonessential information | Reader | essential versus nonessential needs the sense |
| 20 | Semicolons | Reader | semicolon use needs the sense |
| 21 | Colons | Pattern | a colon right after a verb or preposition |
| 22 | Hyphens | Pattern | a hyphen after an -ly adverb, with the -ly nouns and adjectives exempt |
| 23 | Dashes | Pattern | any em dash; error in a formal document |
| 24 | Parentheses | Reader | whether a parenthesis buries an essential condition needs the sense |
| 25 | Slashes | Pattern | and/or |
| 26 | Quotation marks | Pattern | a period or comma outside a closing quotation mark (warning: an identifier may keep it outside) |
| 27 | Apostrophes | Pattern | an apostrophe forming a plural |
| 28 | Exclamation points | Pattern | any exclamation point; error in a formal document |
| 29 | Ellipses | Pattern | an ellipsis |
| 30 | General rule | Reader | capitalization of proper names needs the name list |
| 31 | Company name | Reader | the audience decides Active Alarm Company versus AAC |
| 32 | Job titles | Reader | a title before or after a name needs parsing |
| 33 | Departments and functions | Reader | official department name or generic needs the org chart |
| 34 | Customers, vendors, and parties | Reader | an organization's own styling needs the source |
| 35 | Systems and services | Pattern | a capitalized generic system name mid-sentence |
| 36 | Laws, codes, and standards | Reader | formal law titles need the name list |
| 37 | Headings and titles | Pattern | a run-in label ending in a period at the start of a list item |
| 38 | House number style | Pattern | a figure one through ten before a count noun; a spelled-out number over ten before one |
| 39 | Related numbers | Reader | related numbers need the sense of the series |
| 40 | Numbers at the beginning of a sentence | Pattern | a figure opening a sentence |
| 41 | Indefinite numbers | Reader | indefinite amounts need the sense |
| 42 | Dates | Pattern | an ordinal on a month-first date; a comma between month and year |
| 43 | Numeric dates | Pattern | a numeric date in narrative text; the hand-filled form clause (MM/DD/YYYY, format stated once) is a rendered-form check, so the warning stays |
| 44 | Time | Pattern | ':00' on the hour; 12 a.m. or 12 p.m. |
| 45 | Time ranges | Pattern | an en dash after 'from' |
| 46 | Money | Pattern | '.00' on a whole-dollar amount; '$' with the word dollars |
| 47 | Percentages | Pattern | percent and % mixed in one document; % in narrative prose with no table |
| 48 | Measurements | Pattern | a spelled-out number before a technical unit |
| 49 | Dimensions | Reader | one dimension format per document needs the whole set |
| 50 | Fractions and decimals | Pattern | a decimal under one with no leading zero |
| 51 | Ages, durations, and terms | Reader | technical or contractual significance needs the context |
| 52 | Ordinal numbers | Pattern | 1st through 10th as figures |
| 53 | Telephone numbers | Pattern | a telephone number in parentheses |
| 54 | General rule | Pattern | approx., w/, b/c, thru, pls, dept., mgmt. |
| 55 | Acronyms | Jev | Jev reads each all-capitals term of two to six letters that Appendix C does not list and that is not spelled out with the acronym in parentheses at first use, with the whole document as context, for a product identifier (HDCS) or a term the reader knows |
| 56 | All-capital abbreviations | Pattern | periods in a capital abbreviation |
| 57 | a.m. and p.m. | Pattern | AM, PM, A.M., P.M. |
| 58 | Corporate suffixes | Reader | legal styling needs the source name |
| 59 | Personal suffixes and credentials | Reader | personal suffixes need the person's own style |
| 60 | States | Pattern | City, ST in prose with no ZIP Code after it |
| 61 | U.S. English | Pattern | British spellings |
| 62 | Modern technology terms | Pattern | e-mail, web site, on-line, Internet |
| 63 | Common word pairs | Pattern | a one-word noun form used as a verb, and the reverse |
| 64 | Ampersand | Pattern | an ampersand in prose |
| 65 | etc. | Pattern | 'and etc.' |
| 66 | e.g. and i.e. | Pattern | e.g. or i.e. outside parentheses |
| 67 | Complete sentences | Reader | fragment or complete sentence needs parsing |
| 68 | Agreement | Reader | agreement needs parsing |
| 69 | Singular they | Reader | singular they needs the referent |
| 70 | That and which | Reader | that versus which needs the sense |
| 71 | Who and that | Reader | who versus that needs the referent |
| 72 | Who and whom | Reader | whom needs parsing |
| 73 | Parallel construction | Reader | parallel construction needs the list's grammar |
| 74 | Pronoun reference | Reader | vague pronoun reference needs the sense |
| 75 | Page size | Layout | Word or PDF layout, not text; checked in the rendered document (page size) |
| 76 | Margins | Layout | Word or PDF layout, not text; checked in the rendered document (margins) |
| 77 | Default font | Layout | Word or PDF layout, not text; checked in the rendered document (font, and the form clause: 9 pt labels, 10 pt values, font named on runs and defaults, `designlint.py` D07 and D18) |
| 78 | Text color | Layout | Word or PDF layout, not text; checked in the rendered document (text color) |
| 79 | Alignment | Layout | Word or PDF layout, not text; checked in the rendered document (alignment) |
| 80 | Line and paragraph spacing | Layout | Word or PDF layout, not text; checked in the rendered document (line and paragraph spacing) |
| 81 | Tabs and alignment | Layout | Word or PDF layout, not text; checked in the rendered document (tabs) |
| 82 | Headings | Layout | Word or PDF layout, not text; checked in the rendered document (heading styles and spacing) |
| 83 | Heading hierarchy | Layout | Word or PDF layout, not text; checked in the rendered document (heading hierarchy) |
| 84 | Bold, italics, underlining, and capitals | Pattern | four or more words in all capitals in a row |
| 85 | Page breaks | Layout | Word or PDF layout, not text; checked in the rendered document (page breaks and widows; on a form, the continuation header and the kept-together signature block) |
| 86 | Headers and footers | Layout | Word or PDF layout, not text; checked in the rendered document (headers and footers) |
| 87 | First page | Layout | Word or PDF layout, not text; checked in the rendered document (first page) |
| 88 | Hyperlinks | Pattern | 'Click here' |
| 89 | When to use a list | Reader | whether prose should be a list needs the sense |
| 90 | Bulleted lists | Reader | bullet punctuation consistency needs the list read as a set |
| 91 | Numbered lists | Reader | whether numbers serve a purpose |
| 92 | Introductory statements | Reader | colon before a list needs the sentence |
| 93 | Nested lists | Pattern | a list nested deeper than three levels |
| 94 | Use of tables | Reader | table versus prose needs the sense |
| 95 | Table titles | Pattern | a table with no title line above it |
| 96 | Column headings | Reader | unit and scale in headings need the data |
| 97 | Numeric alignment | Reader | alignment lives in the rendered table |
| 98 | Table formatting | Reader | formatting lives in the rendered table; on a fill-in form, four borders on each labeled cell and no underscore write lines need the rendered form |
| 99 | Empty and zero values | Reader | N/A, Unknown, Unlogged need the data; on a form, a blank in a completed form and an initialed N/A need the filled form |
| 100 | Subject lines | Pattern | a subject line that is only Question, Update, FYI or the like |
| 101 | Opening | Pattern | 'I hope this email finds you well' and its variants |
| 102 | Long emails | Reader | bottom line first needs the reader; Jev Rule 5 covers the opening |
| 103 | Action ownership | Reader | named owners need the facts |
| 104 | Deadlines | Pattern | 'ASAP' |
| 105 | To and Cc | Reader | To versus Cc needs the recipients |
| 106 | Attachments | Reader | attachment naming needs the attachments |
| 107 | Email closing | Reader | the loop closure needs the ask |
| 108 | Email signature | Reader | the signature block needs the template |
| 109 | General standard | Reader | Teams clarity needs the sense |
| 110 | Mentions | Reader | @mentions need the recipients |
| 111 | Permanent records | Reader | permanent record needs the system of record |
| 112 | House letter format | Layout | Word or PDF layout, not text; checked in the rendered document (letter format) |
| 113 | Letter sequence | Layout | Word or PDF layout, not text; checked in the rendered document (letter sequence) |
| 114 | Inside address | Layout | Word or PDF layout, not text; checked in the rendered document (inside address) |
| 115 | Salutation | Layout | Word or PDF layout, not text; checked in the rendered document (salutation) |
| 116 | Subject line | Layout | Word or PDF layout, not text; checked in the rendered document (letter subject line) |
| 117 | Signature block | Layout | Word or PDF layout, not text; checked in the rendered document (signature block) |
| 118 | Memo use | Reader | memo versus email needs the purpose |
| 119 | Memo heading | Layout | Word or PDF layout, not text; checked in the rendered document (memo heading) |
| 120 | Memo body | Layout | Word or PDF layout, not text; checked in the rendered document (memo body spacing) |
| 121 | Report structure | Reader | report structure needs the purpose |
| 122 | Executive summary | Reader | an executive summary's content needs the report |
| 123 | Tables of contents | Layout | Word or PDF layout, not text; checked in the rendered document (table of contents) |
| 124 | Data dates | Pattern | a document with tables and no as-of date or period |
| 125 | Findings and interpretation | Reader | data, cause and action apart needs the sense |
| 126 | Scope writing | Reader | scope items name who, what, quantity, location: needs the facts |
| 127 | Quantities | Reader | quantities where a dispute could arise need the scope |
| 128 | Locations | Reader | specific locations need the site |
| 129 | Work by other parties | Reader | the responsible party needs the facts |
| 130 | Exclusions and assumptions | Reader | exclusions and assumptions need the job |
| 131 | Standard SOP structure | Reader | SOP structure needs the controlled system |
| 132 | Procedure steps | Reader | steps as instructions need parsing |
| 133 | One action per step | Reader | one action per step needs the sense |
| 134 | Roles rather than names | Reader | roles versus names needs the org |
| 135 | Exceptions | Reader | who authorizes an exception needs the facts |
| 136 | Screenshots | Layout | Word or PDF layout, not text; checked in the rendered document (screenshots) |
| 137 | Existing legal language | Reader | legal language stays as approved |
| 138 | Defined terms | Reader | a defined term needs the contract |
| 139 | Shall, must, and will | Reader | shall in a contract is correct; Rule 14 warns elsewhere |
| 140 | Legal names | Reader | legal names need the source |
| 141 | Technical accuracy controls style | Reader | technical accuracy needs the source |
| 142 | Technical units | Reader | unit symbols need the technical context |
| 143 | Model and part numbers | Reader | identifiers copied exactly need the source |
| 144 | Code references | Reader | a code citation needs the code |
| 145 | File names | Reader | the file-name structure needs the customer and project |
| 146 | Avoid in file names | Pattern | final, new, updated, copy in the file name |
| 147 | Final issued documents | Reader | a final issued document's naming needs the record |
| 148 | Writer's review | Reader | the two-pass review is the reader's own work |
| 149 | Read for meaning | Reader | reading for meaning is the reader's own work |
| 150 | Automated tools | Reader | automated tools do not decide |
| 151 | Quick format matrix | Reader | the format matrix lives in the template |
| 152 | When this standard does not answer the question | Reader | the decision sequence is the reader's own work |
| 153 | Scope of this part | Reader | scope of Part XXV |
| 154 | Preserve the writer's voice | Reader | the writer's voice needs the writer |
| 155 | Empty adverbs | Pattern | the empty adverbs the rule and Appendix G8 list, and the G8 filler phrases |
| 156 | Faux-insight setups | Pattern | the Appendix G4 setups |
| 157 | Colon-reveal drama | Pattern | the Appendix H8 colon labels |
| 158 | Importance puffery | Pattern | the Appendix G5 puffery and G11 declaratives |
| 159 | Superficial -ing analysis | Pattern | a trailing participial clause of the Appendix H9 kind |
| 160 | Weasel attribution | Pattern | the Appendix G6 attributions |
| 161 | Synonym cycling | Jev | one question over the whole message: is one actor, system or tool named two ways; skipped for a formal document (reports and proposals are exempt by the rule) unless `--prose` forces narrative |
| 162 | Fake-profound kickers and summary recaps | Pattern and Jev | the Appendix H11 kickers; Jev reads the last paragraph for a recap |
| 163 | Interpretive metadiscourse | Pattern | the Appendix G1, G2, G7, G9 and G10 phrases |
| 164 | Formulaic structures | Pattern and Jev | the Appendix H1 to H6 formulas that have a fixed shape; Jev reads each paragraph for fragmentation |
| 165 | Formatting slop | Pattern | an emoji in a heading; decorative bold inside a sentence |
| 166 | Draft quality check before release | Reader | the release check is the reader's own work |
| 167 | Machine vocabulary | Pattern | the Rule 167 word list and the Appendix G3 jargon, with beacon, harness, gate and robust exempt |
| 168 | Every sentence earns its place | Reader | whether a sentence informs, asks, or changes rights, money, scope, or dates needs the reader and what the reader already has |
| 169 | Formality follows stakes and relationship, not topic | Pattern | the Appendix G12 legalistic phrases and a second contract-section citation, warnings in informal writing only (formal documents exempt) |
| 170 | Cut for need, never for length | Reader | whether the reader would have to write back to ask needs the reader; no length check by design |
