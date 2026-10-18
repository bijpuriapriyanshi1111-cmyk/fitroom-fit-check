# tools

## extract_garment.py

An experiment, not part of the app. It tries to cut a garment out of a photo of a person wearing it, so the photo can be used in the
calculator's "Put the garment's photo on the figure" box. It uses the `u2net_cloth_seg` model from the rembg project, which labels each
pixel as background, upper-body clothes, lower-body clothes or full-body clothes.

```bash
pip install rembg onnxruntime pillow numpy
python3 extract_garment.py photo.jpg out_folder
```

The first run downloads the model (about 176 MB) into `~/.u2net/`. For every label found it saves a transparent PNG, plus a contact sheet
(the photo and each cut-out side by side) and prints how much of the photo each cut-out covers.

What it did on three real product photos (October 2026):

- Garment unobstructed on a plain studio background: a good cut-out, drape and details kept.
- A white handbag in front of the top: the bag was counted as part of the top.
- Hand over the neckline and a busy background: about half the top missing, speckled edges, and the skirt labelled as a garment.

Parts of a garment hidden by an arm, hand or bag cannot be recovered by this model. Filling them in would need an image-generation service.
