#!/bin/bash
# Double-click this file to start FitRoom Fit Check.
# It serves this folder on your own computer and opens it in your browser.
# Your data stays on this computer. (The page only downloads its fonts from Google Fonts.)

cd "$(dirname "$0")" || exit 1
PORT=8765

echo "FitRoom Fit Check is running at http://localhost:$PORT"
echo "Keep this window open while you use it. Close the window (or press Ctrl+C) to stop."
echo

# open the browser one second after the server starts
( sleep 1; open "http://localhost:$PORT" ) &

python3 serve.py "$PORT" || echo "Could not start. If it says the address is in use, FitRoom is probably already running: open http://localhost:$PORT"
