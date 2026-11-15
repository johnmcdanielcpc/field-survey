/* =====================================================================
   SURVEY FORM DEFINITION  —  edit this file to change the questions.
   The phone screens, the missing-info review, the PDF and the Excel
   workbook all follow it.

   Field types
     text | number | textarea | date | person
     choice   tap buttons (options) + Other… yesno   Yes / No (+ Other…)
     multi    pick several buttons + Other… (saved as "A, B")
     check    single checkbox                photo   any number of photos
     video    one or more videos (uploaded to Drive with the photos)
     info     a note shown to the technician (no answer)
     repeat   list of units (RTUs, fans...), each with its own fields

   Field keys
     suggest: [...]        type-ahead suggestions (text)
     options: [...]        buttons (choice)
     showIf: {field, in}   only show when another field in the same unit matches
     hideIf: {field, in}   hide when another field in the same unit matches
     noOther: true         no "Other…" button on this choice
     optional: true        never flagged as missing (notes, "if present" items)
     optionalIf: {field,in} not flagged as missing when another field matches
     expect: true          photo field flagged if it has no photos
     optionsFrom: v=>[...]  extra buttons built from this survey (e.g. fan tags)
     format: 'mmyyyy'      number pad; the "/" is put in automatically
     lookup: true          filled in after the visit (model/serial look-up);
                           shown in a collapsed section, never flagged on site
     plate: true           photo is a data plate / summary sheet (PDF prints it sharper)
     xl: '...'             key used by the Excel builder
   ===================================================================== */

const COND = ['Good', 'Fair', 'Poor'];
const VOLTS = ['115/1', '208/1', '208/3', '230/1', '230/3', '460/3', '480/3', '575/3'];
const CATEGORY = { id: 'category', label: 'Category', type: 'choice', xl: 'category', noOther: true,   // fixed list: it decides the spreadsheet tab
  options: ['Replace', 'Existing to Remain', 'Remove & Cap', 'Not sure'] };
const HEAT_ONLY = { field: 'heatOnly', in: [true] };
// tags of units already entered in this survey (blank tag -> "Exhaust Fan 2" etc., same as the screens)
const tagsIn = (sec, name) => v => ((v[sec] || {}).units || []).map((it, i) => String(it.tag || '').trim() || `${name} ${i + 1}`);
// every panel in every electrical room, as "Panel (Room)" so same-named panels in two rooms stay distinct
const PANELS = v => ((v.electrical || {}).rooms || []).flatMap((r, ri) => {
  const room = String(r.name || '').trim() || `Electrical Room ${ri + 1}`;
  return (r.panels || []).map((p, pi) => `${String(p.name || '').trim() || `Panel ${pi + 1}`} (${room})`);
});
const PANEL = { id: 'panel', label: 'Breaker Panel', type: 'choice', options: [], optionsFrom: PANELS,
  emptyHint: 'No panels entered yet. Add them under Electrical Rooms and they will show here, or tap Other… to type the panel.' };
const BREAKER = { id: 'breaker', label: 'Breaker Size (amps)', type: 'text', inputmode: 'numeric',
  suggest: ['15', '20', '30', '40', '50', '60', '70', '80', '90', '100', '125', '150', '175', '200', '225'] };
const NO_SCHED = { field: 'schedule', in: ['No'] };
const RACKS = v => ((v.machine || {}).rooms || []).flatMap(r => (r.racks || []).map((k, i) => String(k.name || '').trim() || `Rack ${i + 1}`));

window.SURVEY_FORM = {
  id: 'equipment-replacement-survey',
  version: 4,
  title: 'Equipment Replacement Field Survey',
  sections: [
    {
      id: 'site', title: 'Site Information', fields: [
        { id: 'customer', label: 'Customer', type: 'text', suggest: ['Whole Foods', 'Stop & Shop', 'Publix', 'Kroger', "Sedano's"] },
        { id: 'store', label: 'Store Number / Identifier', type: 'text' },
        { id: 'address', label: 'Street Address', type: 'text' },
        { id: 'city', label: 'City', type: 'text' },
        { id: 'state', label: 'State', type: 'text', hint: 'GA, MA, FL…' },
        { id: 'specialist', label: 'CX Specialist', type: 'person' },
        { id: 'date', label: 'Survey Date', type: 'date', default: 'today' },
        { id: 'storeFront', label: 'Store Front', type: 'photo', expect: true },
      ]
    },
    {
      id: 'rtus', title: 'RTUs / HVAC Units', fields: [
        { id: 'units', type: 'repeat', itemName: 'Unit', addLabel: 'Add unit', labelField: 'tag', labelPrefix: 'RTU-', kind: 'rtu', fields: [
          { id: 'tag', label: 'Tag', type: 'text', hint: 'RTU-1, H-1, MAU-2…' },
          { id: 'area', label: 'Area Served', type: 'text', suggest: ['Sales floor', 'Produce', 'Bakery', 'Deli', 'Prepared foods', 'Break room', 'Vestibule', 'Offices', 'Pharmacy', 'Back room'] },
          CATEGORY,
          { id: 'heatOnly', label: 'Heat only (no cooling)', type: 'check', optional: true },
          { id: 'mfr', label: 'Manufacturer', type: 'text', suggest: ['Addison', 'Seasons 4', 'AAON', 'Munters', 'Trane', 'Carrier', 'Lennox', 'York', 'Reznor', 'ICP', 'Daikin', 'Rheem'] },
          { id: 'model', label: 'Model Number', type: 'text' },
          { id: 'serial', label: 'Serial Number', type: 'text' },
          { id: 'dataPlate', label: 'Data Plate', type: 'photo', expect: true, plate: true },
          { id: 'mfgDate', label: 'Mfg Date (MM/YYYY)', type: 'text', format: 'mmyyyy', hint: 'MM/YYYY (or just the year)' },
          { id: 'voltage', label: 'Voltage / Phase', type: 'choice', options: VOLTS },
          { id: 'mca', label: 'MCA', type: 'number' },
          { id: 'mocp', label: 'MOCP', type: 'number' },
          PANEL,
          BREAKER,
          { id: 'controls', label: 'Controls Manufacturer', type: 'text', suggest: ['Danfoss', 'Copeland E3', 'CPC / Emerson', 'Novar', 'T-Stat', 'Unit controller'] },
          { id: 'vfd', label: 'VFD Present', type: 'yesno', hideIf: HEAT_ONLY },
          { id: 'smokeLoc', label: 'Smoke Detector Location', type: 'choice', options: ['In Unit', 'In Duct', 'None'] },
          { id: 'refrigerant', label: 'Refrigerant', type: 'choice', options: ['R-22', 'R-407C', 'R-410A', 'R-422B', 'R-454B', 'R-32'], hideIf: HEAT_ONLY },
          { id: 'coil', label: 'Condition of Condenser Coil', type: 'choice', options: COND, hideIf: HEAT_ONLY },
          { id: 'reclaim', label: 'Heat Reclaim (racks / circuits)', type: 'multi', options: ['None Present', 'Rack A', 'Rack B', 'Rack C', 'Rack D', 'Rack E'], optionsFrom: RACKS, hideIf: HEAT_ONLY },
          { id: 'hgrh', label: 'Hot Gas Reheat', type: 'yesno', hideIf: HEAT_ONLY },
          { id: 'heatPump', label: 'Heat Pump', type: 'yesno', hideIf: HEAT_ONLY },
          { id: 'heatType', label: 'Type of Heat', type: 'choice', options: ['Gas', 'Electric', 'Hot Water', 'None'] },
          { id: 'btuIn', label: 'Heating Input (BTU/hr)', type: 'number', showIf: { field: 'heatType', in: ['Gas'] } },
          { id: 'btuOut', label: 'Heating Output (BTU/hr)', type: 'number', showIf: { field: 'heatType', in: ['Gas'] } },
          { id: 'kw', label: 'Electric Heat (kW)', type: 'number', showIf: { field: 'heatType', in: ['Electric'] } },
          { id: 'oa', label: 'Outside Air', type: 'choice', options: ['Yes', 'Yes, but closed', 'Economizer', 'No'] },
          { id: 'curb', label: 'Roof Curb Size (inches, L x W)', type: 'text' },
          { id: 'curbAdapter', label: 'Roof Curb Adaptor Size (inches) if present', type: 'text', optional: true },
          { id: 'disconnect', label: 'Disconnect (size / fused?)', type: 'text', optional: true },
          { id: 'condition', label: 'Overall Condition of Unit', type: 'choice', options: COND },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'sides', label: 'RTU All 4 Sides', type: 'photo', expect: true },
          { id: 'smokePhoto', label: 'Smoke Detector', type: 'photo' },
          { id: 'spaceSensor', label: 'Space Sensor', type: 'photo' },
          { id: 'other', label: 'Other', type: 'photo' },
          { id: 'tons', label: 'Nominal Tons', type: 'number', lookup: true },
          { id: 'supplyCfm', label: 'Supply CFM', type: 'number', lookup: true },
          { id: 'oaCfm', label: 'Outside Air CFM', type: 'number', lookup: true },
          { id: 'weight', label: 'Unit Weight (lbs)', type: 'number', lookup: true },
        ]}
      ]
    },
    {
      id: 'efs', title: 'Exhaust Fans', fields: [
        { id: 'units', type: 'repeat', itemName: 'Exhaust Fan', addLabel: 'Add exhaust fan', labelField: 'tag', labelPrefix: 'EF-', kind: 'ef', fields: [
          { id: 'tag', label: 'Unit Label', type: 'text' },
          { id: 'area', label: 'Area Served', type: 'text', suggest: ['Compressor room', 'Restrooms', 'Deli hood', 'Bakery', 'Rack oven', 'Elevator room', 'Back room'] },
          CATEGORY,
          { id: 'running', label: 'Running?', type: 'yesno' },
          { id: 'mfr', label: 'Manufacturer', type: 'text', suggest: ['Greenheck', 'Loren Cook', 'CaptiveAire', 'Pennbarry', 'Dayton', 'Twin City', 'Acme'] },
          { id: 'model', label: 'Model Number', type: 'text' },
          { id: 'serial', label: 'Serial Number', type: 'text' },
          { id: 'dataPlate', label: 'Data Plate', type: 'photo', expect: true, plate: true },
          { id: 'mfgDate', label: 'Manufacture Date (MM/YYYY)', type: 'text', format: 'mmyyyy', hint: 'MM/YYYY (or just the year)' },
          { id: 'voltage', label: 'Voltage / Phase', type: 'choice', options: VOLTS },
          PANEL,
          BREAKER,
          { id: 'curb', label: 'Curb Size (inches)', type: 'text' },
          { id: 'curbAdapter', label: 'Curb Adaptor Size (inches) if present', type: 'text', optional: true },
          { id: 'condition', label: 'Overall Condition of Unit', type: 'choice', options: COND },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'sides', label: 'Picture of Fan All 4 Sides', type: 'photo', expect: true },
          { id: 'cfm', label: 'Exhaust CFM (if known)', type: 'number', optional: true },
          { id: 'weight', label: 'Unit Weight (lbs, if known)', type: 'number', optional: true },
        ]}
      ]
    },
    {
      id: 'hoods', title: 'Hoods', fields: [
        { id: 'units', type: 'repeat', itemName: 'Hood', addLabel: 'Add hood', labelField: 'tag', labelPrefix: 'Hood ', kind: 'hood', fields: [
          { id: 'tag', label: 'Unit Label', type: 'text' },
          { id: 'area', label: 'Area Served', type: 'text', suggest: ['Deli', 'Bakery', 'Prepared foods', 'Seafood', 'Pizza', 'Rotisserie'] },
          CATEGORY,
          { id: 'hoodType', label: 'Type of Hood', type: 'choice', options: ['Wall', 'Island', 'Wall used as Island', 'Island used as Wall'] },
          { id: 'mfr', label: 'Manufacturer', type: 'text', suggest: ['CaptiveAire', 'Halton', 'Greenheck', 'Accurex', 'Gaylord'] },
          { id: 'dcv', label: 'Demand Ventilation', type: 'yesno' },
          { id: 'length', label: 'Length (inches)', type: 'number' },
          { id: 'condition', label: 'Overall Condition of Unit', type: 'choice', options: COND },
          { id: 'controls', label: 'Controls', type: 'choice', options: ['Switch', 'Demand Control'] },
          { id: 'fits', label: 'Does Equipment Fit Under Hood', type: 'yesno' },
          { id: 'equipment', label: 'Type of Equipment Under Hood', type: 'multi', options: ['Fryers', 'Oven', 'Rotisserie', 'Griddle', 'Range', 'Pizza oven', 'Smoker', 'Steamer', 'Dishwasher'] },
          { id: 'exhaustOnly', label: 'Exhaust Only Hood', type: 'yesno' },
          { id: 'efs', label: 'Exhaust Fan(s) for this Hood', type: 'multi', options: [], optionsFrom: tagsIn('efs', 'Exhaust Fan'),
            emptyHint: 'No exhaust fans entered yet. Add them under Exhaust Fans and they will show here, or tap Other… to type the tag.' },
          { id: 'maus', label: 'Makeup Air Unit(s) for this Hood', type: 'multi', options: [], optionsFrom: tagsIn('rtus', 'Unit'),
            hideIf: { field: 'exhaustOnly', in: ['Yes'] },
            emptyHint: 'No units entered yet. MAUs are entered under RTUs / HVAC Units and will show here, or tap Other… to type the tag.' },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'photo', label: 'Picture of Hood', type: 'photo', expect: true },
        ]}
      ]
    },
    {
      id: 'electrical', title: 'Electrical Rooms', fields: [
        { id: 'rooms', type: 'repeat', itemName: 'Electrical Room', addLabel: 'Add electrical room', labelField: 'name', labelPrefix: 'Electrical Room ', fields: [
          { id: 'name', label: 'Room Name', type: 'text', suggest: ['Main Electrical Room', 'Back Room', 'Mezzanine', 'Compressor Room', 'Roof'] },
          { id: 'location', label: 'Where is it? (how to find it)', type: 'text', hint: 'e.g. back of house behind receiving, up the mezzanine stairs' },
          { id: 'panels', type: 'repeat', itemName: 'Panel', addLabel: 'Add panel', labelField: 'name', fields: [
            { id: 'name', label: 'Panel Name', type: 'text', hint: 'As labeled on the panel, e.g. LP-1, HA, MDP' },
            { id: 'voltage', label: 'Panel Voltage', type: 'choice', options: ['120/208V 3Ø', '277/480V 3Ø', '120/240V 1Ø', '120/208V 1Ø', '347/600V 3Ø'] },
            { id: 'dataPlate', label: 'Electrical Panel Data Plate', type: 'photo', expect: true, plate: true },
            { id: 'spares', label: 'Electrical Panel Spare Spaces', type: 'text' },
            { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
            { id: 'other', label: 'Other', type: 'photo' },
          ]},
          { id: 'video', label: 'Electrical Room Video', type: 'video', expect: true,
            hint: 'Walk the room slowly and record EVERY panel: open each panel door so the breakers and the panel schedule show clearly, and say the panel name out loud as you film it.' },
          { id: 'notes', label: 'Room Notes', type: 'textarea', optional: true },
          { id: 'photos', label: 'Room Photos', type: 'photo' },
        ]}
      ]
    },
    {
      id: 'gas', title: 'Gas Meter and Pipe Size', fields: [
        { id: 'meterSize', label: 'Meter Size and Gas Pressure Rating', type: 'text' },
        { id: 'pipe', label: 'Main Pipe Size', type: 'text' },
        { id: 'pressure', label: 'Gas Pressure Rating', type: 'text', suggest: ['7" WC', '12" WC', '2 PSI', '5 PSI'] },
        { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
        { id: 'photos', label: 'Gas Meter Photos', type: 'photo', expect: true, plate: true },
      ]
    },
    {
      id: 'machine', title: 'Machine Rooms', fields: [
        { id: 'rooms', type: 'repeat', itemName: 'Machine Room', addLabel: 'Add machine room', labelField: 'name', fields: [
          { id: 'name', label: 'Machine Room Name', type: 'text', suggest: ['Compressor Room 1', 'Compressor Room 2'] },
          { id: 'sealed', label: 'Is Machine Room Sealed', type: 'yesno' },
          { id: 'racks', type: 'repeat', itemName: 'Rack', addLabel: 'Add rack', labelField: 'name', labelPrefix: 'Rack ', fields: [
            { id: 'name', label: 'Rack Name', type: 'text' },
            { id: 'schedule', label: 'Refrigeration Schedule / Summary Available?', type: 'yesno' },
            { id: 'plate', label: 'Refrigeration Rack Data Plate & Refrigeration Summary', type: 'photo', expect: true, plate: true },
            { id: 'thr', label: 'Compressor THR – Total Heat of Rejection (BTU/hr)', type: 'number', optionalIf: NO_SCHED,
              hint: 'Type it from the refrigeration schedule' },
            { id: 'noSchedule', type: 'info', showIf: NO_SCHED,
              text: 'No refrigeration schedule: record the refrigerant and suction setpoint below, and take a photo of EVERY compressor data plate on this rack. THR will be worked out from those. If you know the THR, type it in above.' },
            { id: 'refrigerant', label: 'Refrigerant', type: 'choice', options: ['R-404A', 'R-507', 'R-448A', 'R-449A', 'R-407A', 'R-22', 'R-744 (CO2)'], showIf: NO_SCHED },
            { id: 'suction', label: 'Suction Setpoint (psig or °F)', type: 'text', showIf: NO_SCHED },
            { id: 'compPlates', label: 'Compressor Data Plates (one photo per compressor)', type: 'photo', expect: true, plate: true, showIf: NO_SCHED },
            { id: 'notes', label: 'Rack Notes', type: 'textarea', optional: true },
          ]},
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'other', label: 'Other', type: 'photo' },
        ]}
      ]
    },
    {
      id: 'controls', title: 'Controls', fields: [
        { id: 'mfr', label: 'HVAC Controller Manufacturer', type: 'text', suggest: ['Danfoss', 'Copeland E3', 'CPC / Emerson', 'Novar', 'Micro Thermo'] },
        { id: 'model', label: "Manufacturer's Model", type: 'text' },
        { id: 'version', label: 'Version or Software Revision', type: 'text', optional: true },
        { id: 'photos', label: 'Photos of Controller', type: 'photo', expect: true, plate: true },
        { id: 'notes', label: 'Notes', type: 'textarea', optional: true },
      ]
    },
    {
      id: 'final', title: 'Additional Notes & Photos', fields: [
        { id: 'notes', label: 'General Notes', type: 'textarea', optional: true },
        { id: 'roof', label: 'Roof Type and Equipment 360 View', type: 'photo', expect: true },
        { id: 'roofVideo', label: 'Roof Layout Video', type: 'video', expect: true,
          hint: 'Walk the roof slowly for about 1–2 minutes: every unit, the roof edges, and where the equipment sits relative to the store.' },
        { id: 'los', label: 'Noise / Line of Sight / Neighboring Properties', type: 'photo' },
        { id: 'items', type: 'repeat', itemName: 'Other Item', addLabel: 'Add other item', labelField: 'title', fields: [
          { id: 'title', label: 'Title (what is it?)', type: 'text' },
          { id: 'note', label: 'Note', type: 'textarea', optional: true },
          { id: 'photos', label: 'Photos', type: 'photo' },
        ]},
        { id: 'scope', label: 'Scope of Work / Equipment Replacing', type: 'textarea', optional: true },
      ]
    },
  ]
};
