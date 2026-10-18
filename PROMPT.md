# Prompt to paste into Claude Code

I am building FitRoom Fit Check, a small tool that takes a body (bust, waist, hip, inseam, height) plus a garment size chart and shows the predicted size, tight / fitted / regular / loose zones, and where the hem and sleeve land on a front view figure.

`index.html` in this folder is a working single file version that was built as a Claude artifact. Please turn it into a normal local project and make these changes:

1. Remove everything that depends on the artifact runtime (`window.claude`, the db and assets capabilities). Keep the data in localStorage, and add a button to export and import everything as a JSON file so I never lose my tests.
2. Use my real TrueToForm scan picture as the body. The original screenshots are in `avatars/`. Use `prii_front_original.png` exactly as it is, with its grey background, as the figure picture. Do not redraw or recolour it. Scale it so the head top sits at my entered height and the feet sit on the floor of the tape ruler, and draw the zone bands, hem line and sleeve marker on top.
3. Let me upload a front view screenshot for any person (for example my sister) and store it as a data URL in the saved data, so each person gets their own scan.
4. Add a small calibration step per person: let me click on the picture to mark the natural waist, the hip line, the hem of the feet and the wrist, so the lines use my real scan instead of height proportions. Save those marks with the person.
5. Keep the fit rules exactly as they are for now: gap = garment minus body (plus 2 inches for stretch fabric on garment charts), Tight below 0, Fitted 0 to 1.5, Regular 1.5 to 4, Loose 4 and above.
6. Keep the prediction test log: log the prediction first, then record the real result (size, zones, hem, sleeve) after trying the garment on, with a summary of how often the prediction was right.

Write simple, readable code with comments, and tell me how to run it.
