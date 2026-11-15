/* =====================================================================
   SURVEY FORM DEFINITION  —  edit this file to change the questions.
   The phone screens, the missing-info review, the PDF and the Excel
   workbook all follow it.

   Field types
     text | number | textarea | date | person
     choice   tap buttons (options)          yesno   Yes / No
     check    single checkbox                photo   any number of photos
     repeat   list of units (RTUs, fans...), each with its own fields

   Field keys
     suggest: [...]        type-ahead suggestions (text)
     options: [...]        buttons (choice)
     showIf: {field, in}   only show when another field in the same unit matches
     hideIf: {field, in}   hide when another field in the same unit matches
     optional: true        never flagged as missing (notes, "if present" items)
     expect: true          photo field flagged if it has no photos
     lookup: true          filled in after the visit (model/serial look-up);
                           shown in a collapsed section, never flagged on site
     plate: true           photo is a data plate / summary sheet (PDF prints it sharper)
     xl: '...'             key used by the Excel builder
   ===================================================================== */

const COND = ['Good', 'Fair', 'Poor'];
const VOLTS = ['115/1', '208/1', '208/3', '230/1', '230/3', '460/3', '480/3', '575/3'];
const CATEGORY = { id: 'category', label: 'Category', type: 'choice', xl: 'category',
  options: ['Replace', 'Existing to Remain', 'Remove & Cap', 'Not sure'] };
const HEAT_ONLY = { field: 'heatOnly', in: [true] };

window.SURVEY_FORM = {
  id: 'equipment-replacement-survey',
  version: 2,
  title: 'Equipment Replacement Field Survey',
  sections: [
    {
      id: 'site', title: 'Site Information', fields: [
        { id: 'customer', label: 'Customer', type: 'text', suggest: ['Whole Foods', 'Stop & Shop', 'Publix', 'Kroger', "Sedano's"] },
        { id: 'store', label: 'Store Number / Identifier', type: 'text' },
        { id: 'address', label: 'Address (street, city, state)', type: 'textarea' },
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
          { id: 'mfgDate', label: 'Mfg Date (MM/YYYY)', type: 'text', inputmode: 'numeric' },
          { id: 'voltage', label: 'Voltage / Phase', type: 'choice', options: VOLTS },
          { id: 'mca', label: 'MCA', type: 'number' },
          { id: 'mocp', label: 'MOCP', type: 'number' },
          { id: 'controls', label: 'Controls Manufacturer', type: 'text', suggest: ['Danfoss', 'Copeland E3', 'CPC / Emerson', 'Novar', 'T-Stat', 'Unit controller'] },
          { id: 'vfd', label: 'VFD Present', type: 'yesno', hideIf: HEAT_ONLY },
          { id: 'smokeLoc', label: 'Smoke Detector Location', type: 'choice', options: ['In Unit', 'In Duct', 'None'] },
          { id: 'refrigerant', label: 'Refrigerant', type: 'choice', options: ['R-22', 'R-407C', 'R-410A', 'R-422B', 'R-454B', 'R-32', 'Other'], hideIf: HEAT_ONLY },
          { id: 'coil', label: 'Condition of Condenser Coil', type: 'choice', options: COND, hideIf: HEAT_ONLY },
          { id: 'reclaim', label: 'Heat Reclaim', type: 'text', suggest: ['None Present', 'Rack A', 'Rack B', 'Rack C', 'Rack D', 'Rack E'], hideIf: HEAT_ONLY },
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
          { id: 'mfgDate', label: 'Manufacture Date (MM/YYYY)', type: 'text', inputmode: 'numeric' },
          { id: 'voltage', label: 'Voltage / Phase', type: 'choice', options: VOLTS },
          { id: 'curb', label: 'Curb Size (inches)', type: 'text' },
          { id: 'curbAdapter', label: 'Curb Adaptor Size (inches) if present', type: 'text', optional: true },
          { id: 'condition', label: 'Overall Condition of Unit', type: 'choice', options: COND },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'sides', label: 'Picture of Fan All 4 Sides', type: 'photo', expect: true },
          { id: 'cfm', label: 'Exhaust CFM', type: 'number', lookup: true },
          { id: 'weight', label: 'Unit Weight (lbs)', type: 'number', lookup: true },
        ]}
      ]
    },
    {
      id: 'hoods', title: 'Hoods', fields: [
        { id: 'units', type: 'repeat', itemName: 'Hood', addLabel: 'Add hood', labelField: 'tag', labelPrefix: 'Hood ', kind: 'hood', fields: [
          { id: 'tag', label: 'Unit Label', type: 'text' },
          { id: 'area', label: 'Area Served', type: 'text', suggest: ['Deli', 'Bakery', 'Prepared foods', 'Seafood', 'Pizza', 'Rotisserie'] },
          CATEGORY,
          { id: 'hoodType', label: 'Type of Hood', type: 'choice', options: ['Wall canopy', 'Island canopy', 'Back shelf', 'Other'] },
          { id: 'mfr', label: 'Manufacturer', type: 'text', suggest: ['CaptiveAire', 'Halton', 'Greenheck', 'Accurex', 'Gaylord'] },
          { id: 'dcv', label: 'Demand Ventilation', type: 'yesno' },
          { id: 'length', label: 'Length (inches)', type: 'number' },
          { id: 'depth', label: 'Depth (inches)', type: 'number' },
          { id: 'condition', label: 'Overall Condition of Unit', type: 'choice', options: COND },
          { id: 'controls', label: 'Controls', type: 'choice', options: ['Switch', 'Demand Control', 'Other'] },
          { id: 'fits', label: 'Does Equipment Fit Under Hood', type: 'yesno' },
          { id: 'equipment', label: 'Type of Equipment Under Hood', type: 'text', suggest: ['Fryers', 'Oven', 'Rotisserie', 'Griddle', 'Pizza oven', 'Smoker', 'Dishwasher'] },
          { id: 'exhaustOnly', label: 'Exhaust Only Hood', type: 'yesno' },
          { id: 'ef', label: 'Associated Exhaust Fan (tag)', type: 'text' },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'photo', label: 'Picture of Hood', type: 'photo', expect: true },
          { id: 'exhaustCfm', label: 'Hood Exhaust CFM', type: 'number', lookup: true },
          { id: 'makeupCfm', label: 'Hood Makeup CFM', type: 'number', lookup: true },
        ]}
      ]
    },
    {
      id: 'electrical', title: 'Electrical Room', fields: [
        { id: 'panels', type: 'repeat', itemName: 'Panel', addLabel: 'Add panel', labelField: 'name', fields: [
          { id: 'name', label: 'Panel Name', type: 'text', suggest: ['480/3', '208/3', 'LG', 'MDP'] },
          { id: 'dataPlate', label: 'Electrical Panel Data Plate', type: 'photo', expect: true, plate: true },
          { id: 'spares', label: 'Electrical Panel Spare Spaces', type: 'text' },
          { id: 'notes', label: 'Additional Notes', type: 'textarea', optional: true },
          { id: 'other', label: 'Other', type: 'photo' },
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
            { id: 'plate', label: 'Refrigeration Rack Data Plate & Refrigeration Summary', type: 'photo', expect: true, plate: true },
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
