# Portfolio Sweep — 2026-08-11

`verify_package.py "P:\Jobs" --sweep`, run 2026-08-11.

- **25 drafted packages carry findings** and are listed below
- 1 drafted package clean
- 259 folders have no drafted schedule and were skipped, not failed

A FAIL is mechanically wrong against DRAFTER-PRESEND. A WARN needs a human to judge it.
Signed and exported packages are history: fix the pattern in the template and the standard, 
not the archive. Anything still in flight is worth correcting before it goes out.

---

## Recurring patterns, most common first

| Count | Status | Finding |
|---|---|---|
| 22 | WARN | Permit procurement clarification present |
| 21 | WARN | SOW carries "at the site listed above" |
| 21 | WARN | SOW carries "as itemized in the Equipment and Labor" |
| 20 | FAIL | Validity bullet opens "Pricing is valid for 30 days" |
| 19 | WARN | Clarification count within 12-16 |
| 16 | WARN | Purchase Price is a SUM over the equipment rows |
| 12 | FAIL | Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES" |
| 12 | WARN | Equipment heading reads "EQUIPMENT AND LABOR" |
| 12 | WARN | SOW designation token present |
| 12 | WARN | Exclusions section present |
| 11 | FAIL | Every equipment line carries a Qty |
| 11 | WARN | System header present |
| 9 | WARN | Filename names every system sold |
| 7 | FAIL | Prospect # filled |
| 6 | FAIL | Clarifications do not say "proposal" |
| 6 | WARN | Exclusion count within 8-10 |
| 4 | FAIL | Purchase Price equals the proposal total |
| 3 | FAIL | No exclusion excludes permit procurement |
| 3 | FAIL | Purchase Price non-zero |
| 3 | FAIL | Deposit bullet present (price over $5,000) |
| 2 | FAIL | System headers use approved names |
| 2 | WARN | Deposit amount is 50% of Purchase Price |

The top three are all standards issues rather than one-off mistakes, and two of them
trace to defects fixed in the template today: the `Quotation is valid` wording and the
Purchase Price formula. Packages drafted before today inherited both.

---

## By job

### CUSTOMER-19_SITE-19_Fire Additions JOB-19
*3 fail, 5 warn*

**FAIL**
- Every equipment line carries a Qty  —  rows 44
- Validity bullet opens "Pricing is valid for 30 days"
- No exclusion excludes permit procurement  —  Permits and associated fees

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  5140
- Clarification count within 12-16  —  23 (cell A57)
- Permit procurement clarification present

### CUSTOMER-20_SITE-20 - Intrusion Alarm LD#PROSPECT-20
*2 fail, 4 warn*

**FAIL**
- Clarifications do not say "proposal"
- No deposit bullet (price at or under $5,000)

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  1098
- Permit procurement clarification present

### CUSTOMER-21 SITE-21 - Intrusion Alarm JOB-21
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Validity bullet opens "Pricing is valid for 30 days"
- No exclusion excludes permit procurement  —  Exclusions: Painting and patching of any walls or surfaces, Conduit/ra
- Purchase Price equals the proposal total  —  schedule 1800.0 vs proposal 1750.0 (Proposal - High Temp Monitor CO 1.pdf)

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Purchase Price is a SUM over the equipment rows  —  1800
- Clarification count within 12-16  —  6 (cell A35)
- Exclusion count within 8-10  —  2
- Permit procurement clarification present

### CUSTOMER-22_SITE-22_Intrusion, Access and CCTV Install JOB-22
*9 fail, 11 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Sales representative filled
- Prospect # filled  —  (no label)
- No "TBD" in the SOW
- Every equipment line carries a Qty  —  rows 66
- Purchase Price non-zero  —  None (literal)
- Monthly Total equals the service lines  —  None (literal) vs 0
- Validity bullet opens "Pricing is valid for 30 days"
- Purchase Price equals the proposal total  —  schedule None vs proposal 21950.0 (CUSTOMER-22 - SITE-22 - Security Install Proposal.pdf)

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- System header present  —  no "System:" line in the equipment block
- Purchase Price is a SUM over the equipment rows  —  (empty)
- Balance = Purchase Price less Deposit  —  (empty) expected =G75-G76
- Monthly Total is a SUM  —  (empty)
- Clarification count within 12-16  —  10 (cell A89)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Access Control

### CPD_Douglass Park Cultural and Community Center_1401 S Sacramento Drive_CCTV Installation WO 39564
*3 fail, 6 warn*

**FAIL**
- Validity bullet opens "Pricing is valid for 30 days"  —  found "Quotation is valid"
- Clarifications do not say "proposal"
- Purchase Price equals the proposal total  —  schedule 24962.0 vs proposal 24914.0 (CPD_Douglass Park Cultural and Community Center_1401 S Sacramento Drive_CCTV Installation Proposal.pdf)

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- Purchase Price is a SUM over the equipment rows  —  24962
- Exclusion count within 8-10  —  6
- Permit procurement clarification present

### CPD_Douglass Park Landscape - CCTV Install WO 18960
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_Eckhart Park_1330 W Chicago Avenue_Video Surveillance Installation LD#Z-4169
*0 fail, 2 warn*

**WARN**
- Purchase Price is a SUM over the equipment rows  —  21820
- Clarification count within 12-16  —  18 (cell A51)

### CPD_Fosco Park_1312 S Racine Avenue_Video Surveillance Installation LD#Z-4184
*0 fail, 2 warn*

**WARN**
- Purchase Price is a SUM over the equipment rows  —  18754
- Clarification count within 12-16  —  21 (cell A55)

### CPD_Garfield Park Conservatory_300 N Central Park Avenue_Fire Alarm & Intrusion Modifications WO 37234
*2 fail, 5 warn*

**FAIL**
- Validity bullet opens "Pricing is valid for 30 days"
- No exclusion excludes permit procurement  —  Exclusions: Permits, inspections, engineered drawings, or AHJ approval

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  2316
- Exclusion count within 8-10  —  1
- Permit procurement clarification present

### CPD_Gompers Park Landscape - CCTV Install WO 18890
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_Marquette Park Landscape - CCTV Install WO 18961
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_McKinley Park Landscape - CCTV Install WO 18962
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_Montrose Park Landscape - CCTV Install WO 18963
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_Portage Park Service Yard_CCTV Install WO 19059
*4 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Prospect # filled  —  (no label)
- Every equipment line carries a Qty  —  rows 27
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  10 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Video Surveillance

### CPD_Riis Park Fieldhouse_6100 W Fullerton Ave_Area of Rescue Communicator WO 26782
*2 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  5 (cell A38)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Filename names every system sold  —  missing Elevator Monitoring

### CUSTOMER-23_SITE-23 - Intrusion Monitoring Increase LD#PROSPECT-23
*3 fail, 9 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Purchase Price non-zero  —  0.0 (recomputed)
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- One schedule in the folder  —  2 found; newest used: CUSTOMER-23 - Fire Alarm Equip & Svc Schedule.xlsx
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  4 (cell A36)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present

### CUSTOMER-24 SITE-24 Access-Network
*2 fail, 3 warn*

**FAIL**
- System headers use approved names  —  System: Network Cabling; System: Access Control
- Deposit bullet present (price over $5,000)

**WARN**
- Purchase Price is a SUM over the equipment rows  —  5782
- Deposit amount is 50% of Purchase Price  —  0.0 vs expected 2891.0
- Purchase Price reconciles to the proposal  —  proposal carries 2 totals 1,184.00, 4,598.00; schedule 5,782.00

### CUSTOMER-25 SITE-25 Network Cabling JOB-25
*6 fail, 7 warn*

**FAIL**
- Every equipment line carries a Qty  —  rows 25,26,27,28
- System headers use approved names  —  System: Network
- Validity bullet opens "Pricing is valid for 30 days"
- Clarifications do not say "proposal"
- Deposit bullet present (price over $5,000)
- Purchase Price equals the proposal total  —  schedule 5952.0 vs proposal 5780.0 (CUSTOMER-25 SITE-25 Network Cabling Proposal Rev.3.pdf)

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  5952
- Clarification count within 12-16  —  9 (cell A41)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present
- Deposit amount is 50% of Purchase Price  —  0.0 vs expected 2976.0

### CUSTOMER-26 - SITE-26 - Fire Alarm - Suite 31 OTHER-26-1 - JOB-26
*3 fail, 6 warn*

**FAIL**
- Every equipment line carries a Qty  —  rows 41,42
- Validity bullet opens "Pricing is valid for 30 days"
- Clarifications do not say "proposal"

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- Purchase Price is a SUM over the equipment rows  —  10328
- Exclusion count within 8-10  —  2
- Permit procurement clarification present

### CUSTOMER-27 - SITE-27 - Fire Alarm Upgrade- PROSPECT-27
*2 fail, 6 warn*

**FAIL**
- Validity bullet opens "Pricing is valid for 30 days"
- Rider Subscriber name matches the schedule  —  rider "CUSTOMER-27"

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  16456
- Clarification count within 12-16  —  19 (cell A52)
- Exclusion count within 8-10  —  14
- Permit procurement clarification present

### CUSTOMER-28 SITE-28 CCTV- Burg - LD#PROSPECT-28
*1 fail, 7 warn*

**FAIL**
- Validity bullet opens "Pricing is valid for 30 days"

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- SOW designation token present  —  new/replacement/takeover/addition
- Purchase Price is a SUM over the equipment rows  —  3658
- Clarification count within 12-16  —  3 (cell A45)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present

### CUSTOMER-10 SITE-10 CCTV Upgrade LD#PROSPECT-10
*0 fail, 2 warn*

**WARN**
- Purchase Price is a SUM over the equipment rows  —  16500
- Permit procurement clarification present

### CUSTOMER-29_SITE-29 - Panic Buttons JOB-29
*1 fail, 6 warn*

**FAIL**
- Validity bullet opens "Pricing is valid for 30 days"  —  found "Quotation is valid"

**WARN**
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  224
- Clarification count within 12-16  —  9 (cell A38)
- Permit procurement clarification present
- Filename names every system sold  —  missing Intrusion Alarm

### CUSTOMER-30_SITE-30_Renovation Project JOB-30
*5 fail, 7 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Every equipment line carries a Qty  —  rows 41,42,46
- Validity bullet opens "Pricing is valid for 30 days"
- Clarifications do not say "proposal"
- Deposit bullet present (price over $5,000)

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- System header present  —  no "System:" line in the equipment block
- Clarification count within 12-16  —  19 (cell A68)
- Exclusions section present  —  no "Exclusions" header in the block
- Permit procurement clarification present

### CUSTOMER-31 - OTHER-31-1 - SITE-31 -  Fire Alarm Install JOB-31
*4 fail, 7 warn*

**FAIL**
- Heading reads "SCHEDULE OF EQUIPMENT AND SERVICES"  —  SCHEDULE OF EQUIPMENT & SERVICES
- Purchase Price non-zero  —  None (formula is not a simple SUM)
- Validity bullet opens "Pricing is valid for 30 days"
- Clarifications do not say "proposal"

**WARN**
- Equipment heading reads "EQUIPMENT AND LABOR"  —  EQUIPMENT
- SOW carries "at the site listed above"
- SOW carries "as itemized in the Equipment and Labor"
- Purchase Price is a SUM over the equipment rows  —  =G32
- Clarification count within 12-16  —  8 (cell A64)
- Exclusion count within 8-10  —  2
- Permit procurement clarification present
