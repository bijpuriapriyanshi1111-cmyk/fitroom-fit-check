/*
  example-charts.js — sample garments used by the checks in fit.test.js.
  (The page itself no longer has an example menu, so these are only for testing.)

  The numbers are examples. They are not real brand charts, except the SZN lace top,
  which came from your own sheet.
*/
FitRoom.Examples = (function () {

  // A chart row with some numbers filled in. In a range chart "bust" is the minimum and "bustMax" the maximum.
  function row(size, values) {
    return Object.assign(FitRoom.Fit.blankRow(size), values);
  }

  const list = {

    // ----- charts that list the garment's own measurements -----
    szn: {
      label: 'SZN lace square neck top (from your sheet)',
      name: 'SZN lace square neck top', type: 'top', fabric: 'stretch', chartType: 'garment', unit: 'in',
      rows: [
        row('XS', { bust: '32', length: '21' }), row('S', { bust: '34', length: '21' }), row('M', { bust: '36', length: '21' }),
        row('L', { bust: '38', length: '22' }), row('XL', { bust: '40', length: '22' }), row('XXL', { bust: '42', length: '22' })
      ]
    },
    long: {
      label: 'Long sleeve fitted top (example numbers)',
      name: 'Long sleeve fitted top', type: 'top', fabric: 'stretch', chartType: 'garment', unit: 'in',
      rows: [
        row('XS', { bust: '33', waist: '27', hip: '35.5', length: '22', sleeve: '22.5' }),
        row('S', { bust: '35', waist: '29', hip: '37.5', length: '22.5', sleeve: '23' }),
        row('M', { bust: '37', waist: '31', hip: '39.5', length: '23', sleeve: '23.5' }),
        row('L', { bust: '39', waist: '33', hip: '41.5', length: '23.5', sleeve: '24' }),
        row('XL', { bust: '41', waist: '35', hip: '43.5', length: '24', sleeve: '24.5' })
      ]
    },
    jeans: {
      label: 'Straight jeans (example numbers)',
      name: 'Straight jeans', type: 'pants', fabric: 'none', chartType: 'garment', unit: 'in',
      rows: [
        row('26', { waist: '26', hip: '36.5', inseam: '29.5' }), row('28', { waist: '28', hip: '38.5', inseam: '29.5' }),
        row('30', { waist: '30', hip: '40.5', inseam: '29.5' }), row('32', { waist: '32', hip: '42.5', inseam: '29.5' }),
        row('34', { waist: '34', hip: '44.5', inseam: '29.5' })
      ]
    },
    dress: {
      label: 'Midi wrap dress (example numbers)',
      name: 'Midi wrap dress', type: 'dress', fabric: 'none', chartType: 'garment', unit: 'in',
      rows: [
        row('S', { bust: '34', waist: '28', hip: '37', length: '44', sleeve: '9' }),
        row('M', { bust: '36', waist: '30', hip: '39', length: '44.5', sleeve: '9.5' }),
        row('L', { bust: '38', waist: '32', hip: '41', length: '45', sleeve: '10' }),
        row('XL', { bust: '40', waist: '34', hip: '43', length: '45.5', sleeve: '10.5' })
      ]
    },

    // ----- charts that list a body range for each size (like H&M) -----
    // The M row uses the numbers from your brief: chest 35.5 to 38.5, waist 29 to 32.5, low hip 37.25 to 39.5.
    hm: {
      label: 'Range chart top, H&M style (example numbers)',
      name: 'Range chart top', type: 'top', fabric: 'none', chartType: 'range', unit: 'in',
      rows: [
        row('XS', { bust: '29.5', bustMax: '32.25', waist: '23.5', waistMax: '26.25', hip: '32', hipMax: '35', length: '24', sleeve: '24' }),
        row('S', { bust: '32.5', bustMax: '35.25', waist: '26.5', waistMax: '28.75', hip: '35.25', hipMax: '37', length: '24', sleeve: '24' }),
        row('M', { bust: '35.5', bustMax: '38.5', waist: '29', waistMax: '32.5', hip: '37.25', hipMax: '39.5', length: '24.5', sleeve: '24.5' }),
        row('L', { bust: '38.75', bustMax: '41.5', waist: '32.75', waistMax: '36', hip: '39.75', hipMax: '42.25', length: '25', sleeve: '25' }),
        row('XL', { bust: '41.75', bustMax: '44.5', waist: '36.25', waistMax: '39.5', hip: '42.5', hipMax: '45', length: '25.5', sleeve: '25.5' })
      ]
    },
    crop: {
      label: 'Crop top, hip not covered (example numbers)',
      name: 'Crop top', type: 'top', fabric: 'none', chartType: 'range', unit: 'in',
      rows: [
        row('XS', { bust: '29.5', bustMax: '32.25', waist: '23.5', waistMax: '26.25', hip: '32', hipMax: '35', length: '15' }),
        row('S', { bust: '32.5', bustMax: '35.25', waist: '26.5', waistMax: '28.75', hip: '35.25', hipMax: '37', length: '15' }),
        row('M', { bust: '35.5', bustMax: '38.5', waist: '29', waistMax: '32.5', hip: '37.25', hipMax: '39.5', length: '15.5' }),
        row('L', { bust: '38.75', bustMax: '41.5', waist: '32.75', waistMax: '36', hip: '39.75', hipMax: '42.25', length: '16' })
      ]
    }
  };

  return { row, list };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.Examples;
