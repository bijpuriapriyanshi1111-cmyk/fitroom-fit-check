# FitRoom Fit Check

Put in a body and a size chart. It shows the predicted size, which zones are tight / fitted / regular / loose
(or run small / run big for range charts), and where the hem and sleeve land on a front view scan of the body.

It is a normal local project: plain HTML, CSS and JavaScript. No install, no build, no account.

## How to run it

**Easiest:** double-click `start.command`. A window opens (leave it open) and your browser goes to
`http://localhost:8765`. Close that window to stop.

If macOS refuses to open it the first time, right-click the file, choose **Open**, then **Open** again.

**From Terminal instead:**

```bash
cd path/to/fitroom-fit-check
python3 serve.py
```

then open <http://localhost:8765>.

You can also just double-click `index.html`. It works, but your browser keeps the saved data separately for
"opened from a file" and for `localhost:8765`. **Pick one way and always use that one**, or your tests will look
like they vanished. (The line at the top of the page shows where your data is being saved.)

## Your data and the backup

Everything you enter (people, scan pictures, calibration marks, the current chart, the test log) is saved
automatically in this browser. It stays there until you clear the browser's site data.

- **Export data (JSON file)** downloads everything as one file. Do this after each testing session.
- **Import data** loads such a file back. It *replaces* what is in the browser, and asks first.

## The steps

1. **Body:** type the scan numbers and the tape numbers (inches). Prii's scan is already there.
2. **Add person** for someone else, then **Add or replace front view picture** to upload their scan screenshot.
   It is stored with that person only.
3. **Calibrate:** click the head top, shoulder, bust, waist, hip, floor and wrist on the picture. The head top
   becomes the entered height and the floor sits on the floor of the tape ruler. A point you skip uses height
   proportions, and the caption under the figure tells you which ones.
4. **Garment and size chart:** type the garment's name and paste its product link (an **Open link** button
   appears). To save typing, open **Paste a size chart instead of typing it**, paste the table you copied from the
   product page, check what was understood, and press **Use this chart**. Then pick **Garment measurements** (one number per cell) or **Body ranges**
   (a min and a max per cell, like H&M), and fill in the table. Switch the chart between inches and
   centimetres at any time. For garment measurements, paste the **Material** from the product page and the tool guesses the **Fabric**
   (Stretch / Elastic waist / No stretch) and says why; you can always change it by hand. For Stretch, a second switch
   says **how much it stretches** (Low / Medium / High). The tool reads it from words like "Stretchability: High" or
   "slight stretch" in the material box, or you pick it yourself.
   If the real hem sits higher or lower on you than the chart length suggests
   (a stretchy top that rides up), set a **Hem adjustment** under the chart. For a tube top, strapless top or bandeau, set **Length is counted from: Top edge**. **Start a new chart** clears the name, link and numbers for the next garment;
   tests already in the log are kept.
   The chart has a **Hem** column for tops and dresses: the distance all the way round the bottom edge. The fit rules do not use it
   (it does not change the size or the tight / loose verdicts); the garment photo below does.
   **Garment photo on the figure (a rough test):** open **Put the garment's photo on the figure** under the chart, and add a flat
   photo of just the garment on a plain background (a flat-lay or ghost-mannequin shot; a model wearing it will not cut out, and the
   tool warns you when it looks like one). The background is removed and the garment is placed on the scan from the shoulder to the
   hem (so the hem adjustment moves it too). Its width at the bust, waist, hip and hem comes from the body's REAL outline in the scan
   at that height, centred where the body really is, and wider where the chart says the garment is bigger than you. Below the bust it follows the body's outline row by row, so it can never be narrower than you and hugs the waist curve. Where it is
   smaller than you it is drawn as wide as you, because it would be stretched to fit; the zone colour says whether that is fine or
   tight. **Wrap it round the body** (on by default) curves the fabric toward the sides and lays the scan's own soft lighting over it,
   so it looks like it goes round you; untick it for a flat cut-out. Click the sizes under Result to see each one. It only draws
   tops and dresses, and only uses garment widths from a garment-measurements chart (a body chart fits it to your outline and the
   length). `tests/sample-garment-photo.png` is a photo to try it with. The photo is kept as a small cut-out in your saved data.
   Not real 3D: there are no folds that react to the body, and it is the front view only.
5. **Result:** scan numbers and tape numbers side by side, the zone details, and the figure. On the figure, each zone (bust, waist, hip) has a
   coloured bar across the body at its line. The bar is **exactly as wide as the garment is at that line** (with a garment photo, how far the
   photo reaches there; without one, the garment's width worked out the same way as the body's). Its colour is the verdict (tight, fitted,
   regular, loose); how many inches of room or short is in the label beside it.
6. **Log this prediction** before you look at the tag. After trying the garment on, fill in what really happened.
   The summary shows how often the prediction was right, for the scan numbers and the tape numbers separately.

## How the size is picked

**Body, one number ("to fit"):** the chart gives one body measurement per size ("To fit: bust 34"). Each size covers the
bodies halfway to its neighbours (32 and 34 meet at 33), then it is treated like a range chart: a body exactly halfway goes
to the larger size.

**Garment measurements:** room = garment minus body, plus the stretch allowance where the fabric gives:
**Stretch** adds it everywhere, **Elastic waist** adds a flat 2 in to the waist only (track pants, joggers, drawstring
trousers), **No stretch** adds nothing. For **Stretch** the allowance depends on how much it stretches:

| Level | Allowance | Typical fabric |
| --- | --- | --- |
| Low (the default) | a flat 2 in | stretch denim, a little elastane |
| Medium | 10% of that size's own measurement | a stretchy knit |
| High | 18% of that size's own measurement | a slim ribbed tank or body-hugging knit |

The percentages are starting guesses: High comes from one garment (a slim ribbed tank top whose size M fits, which needs
16 to 22% at the bust) and Medium is a plain guess. They sit in the **Fit rules** box, so change them when the test log shows
a stretchy top that came out wrong.
Tight below 0, Fitted 0 to 1.5, Regular 1.5 to 4, Loose 4 and above.
The smallest size with no tight zone wins; if every size is tight somewhere, the largest.

**Body ranges (and "to fit" charts):** for each zone the body is compared with the size's range.
Inside = *Your size*. Above the maximum = *Runs small* (by how many inches). Below the minimum = *Runs big*.

**Closest fit first.** A miss of half an inch or less is inside normal tape-measure error, so a size that misses by that
little in every zone is still *acceptable*.

1. Of the acceptable sizes, the one that misses the body **least** wins.
2. If two sizes are about equally close (within 0.1 in), the **fabric** decides: *Stretch* takes the smaller size
   (comfortable, and a bigger size can slip or gape), anything else takes the larger (the safer one). A short
   **Close call** note says so. Set the fabric (or paste the material) so the tie goes the right way.
3. If **no** size is acceptable (every size misses somewhere by more than half an inch), the older rules apply: each
   zone belongs to the size whose range contains it (or the larger one if it sits in a gap), the size with the most zones
   wins, a tie goes to the larger size (the smaller if the fabric stretches), and a size that runs small by more than half
   an inch moves up one size. A **Between sizes** note names the zones.
4. A zone the chart leaves empty, or that the garment does not reach (hip on a crop top), is ignored.

List the sizes from smallest to largest in the chart.

## Where things are

| File | What it does |
| --- | --- |
| `start.command` | Double-click to start (runs `serve.py`) |
| `serve.py` | A tiny local web server: always serves the newest files, answers only on this Mac |
| `index.html` | The page |
| `css/style.css` | Looks |
| `js/chartparse.js` | Reads a size chart pasted as text (tables, one cell per line, "S: Width: 53 cm" lines) |
| `js/material.js` | Guesses stretch / no stretch, and how much, from the material text (a plain list of rules) |
| `js/fit.js` | The fit rules and size prediction (no page code) |
| `js/geometry.js` | Turns calibration marks into inches on the body |
| `js/garmentimage.js` | The garment photo test: cuts out the background, fits the garment to the body's outline in the scan, wraps and lights it |
| `js/figure.js` | Draws the scan, tape, garment photo, bands, hem line, sleeve marker |
| `js/calibrate.js` | The click-to-mark dialog |
| `js/storage.js` | Saving in the browser, export and import |
| `js/app.js` | The page logic: panels, buttons, test log |
| `avatars/` | Your scan screenshots. `prii_front_original.png` is used exactly as it is |
| `tests/fit.test.js` | Checks for the fit rules |
| `tests/example-charts.js` | Sample charts the checks use (the page has no example menu) |

To run the checks (needs Node): `node tests/fit.test.js`

## For contributors

- Plain HTML, CSS and JavaScript. No build step, no packages. The scripts are classic `<script>` files that share one `FitRoom` object, loaded in the
  order listed in `index.html` (util, storage, geometry, fit, material, chartparse, garmentimage, figure, calibrate, app).
- `js/fit.js`, `js/geometry.js`, `js/material.js`, `js/chartparse.js` and the pixel functions in `js/garmentimage.js` never touch the page, and are
  covered by `node tests/fit.test.js` (one line per check; it exits with an error if any fails). Please keep it passing and add a check with a change.
- Saved data lives in the browser (`localStorage`, one blob). **Export data** / **Import data** move it between browsers and computers.
- `avatars/prii_front_original.png` is the built-in scan. Other people's scans are uploaded in the page and stored in the saved data.

Known rough edges and open ideas:

- The stretch percentages (High 18%, Medium 10%) are starting guesses: High comes from one garment (a slim ribbed tank that fits size M), Medium has no data.
  Tune them from the test log.
- The Hem column is not part of the fit verdicts; it only sets the width of the bottom edge in the garment photo.
- The garment photo is a 2D wrap: it follows the scan's outline and lighting, but has no folds that react to the body, and needs a flat photo of the garment.
  The safety checks do not catch a cut-out that is full of holes (a fill-of-bounding-box check would).
- The size chart reader takes pasted text only. Reading a screenshot of a chart would need an AI service and an API key.
- `tools/extract_garment.py` is an experiment in cutting garments out of photos of people (see `tools/README.md`).
