/*
  material.js — guesses from the material text of a product page whether the fabric stretches.

  You paste the material line ("95% cotton, 5% elastane") or a longer description from the product page.
  The guess is a plain list of rules, checked in this order. The first rule that matches wins:

    1. Words that say there is NO stretch ("non-stretch", "no elastane", "rigid")      -> No stretch
         ...unless the text also mentions an elastic waist                               -> Elastic waist
    2. A stretch fibre (elastane, spandex, lycra) or words like "stretchy", "4-way"      -> Stretch
    3. A knit fabric (jersey, ribbed, knit, interlock, fleece)                           -> Stretch (a bit less sure)
    4. An elastic waistband ("elastic waist", "elasticated")                             -> Elastic waist
    5. A woven fabric (denim, linen, poplin, twill, chino, satin ...)                    -> No stretch
    6. Only a fibre name (cotton, polyester, viscose ...)                                -> No stretch, "just a guess"
    7. Nothing recognised                                                                -> no guess

  Whenever the answer is Stretch, the text is also searched for HOW MUCH it stretches ("Stretchability: High",
  "medium stretch", "slight stretch"). That is the second part of the answer, the stretch level: 'high', 'medium',
  'low', or null when the text does not say. A text that only names the level ("Stretchability: High") counts as
  Stretch too, and "Stretchability: None" counts as No stretch.

  A drawstring alone does NOT count as an elastic waist: it lets you tighten the waist, not loosen it.

  The answer is { fabric, sure, reason, level, levelWhy }. fabric is 'stretch', 'elastic-waist' or 'none' (the same
  names the Fabric switch uses). level and levelWhy are only filled in for Stretch. sure is 'sure', 'probably' or 'just a guess'. It is only ever a guess: the page
  always lets you change the fabric yourself.
*/
FitRoom.Material = (function () {

  const STRETCH_FIBRE = /elastane|spandex|lycra|elastodiene|elastomultiester|elasterell/;
  const STRETCH_WORDS = /\bstretch(y|able)?\b|elasticity|\b(2|4|two|four)[- ]way\b/;
  const NO_STRETCH = /\bnon[- ]?stretch\b|\bno stretch\b|\brigid\b|\bzero stretch\b|\b(no|without|zero)\s+(elastane|spandex|lycra|stretch)\b|\b(elastane|spandex|lycra)[- ]free\b|\bstretchability\s*[:\-]?\s*(none|no|nil|zero)\b/;
  // How much it stretches. "Stretchability: High" is how some shops label it; the others are plain phrases.
  const LEVEL_WORDS = {
    high: /\bstretchability\s*[:\-]?\s*(very\s+)?high\b|\b(high|super|extra|very|maximum)[- ]?(stretch|stretchy|elastic)\b|\bhighly\s+(stretchy|elastic|stretchable)\b/,
    medium: /\bstretchability\s*[:\-]?\s*(medium|moderate|mid|average)\b|\b(medium|moderate|mid)[- ]stretch(y)?\b/,
    low: /\bstretchability\s*[:\-]?\s*(low|slight|minimal|little)\b|\b(low|slight|light|minimal|mild)[- ]stretch\b|\bslightly stretchy\b|\bcomfort stretch\b/
  };
  const KNIT = /\bjersey\b|\bknit(ted)?\b|\brib(bed)?\b|\binterlock\b|\bpique\b|\bpiqué\b|\bfleece\b|\bterry\b/;
  const ELASTIC_WAIST = /elastic/;                          // "elastic", "elasticated" (not "elastane", which is a fibre)
  const WOVEN = /\bdenim\b|\blinen\b|\bpoplin\b|\btwill\b|\bchino\b|\bcanvas\b|\bsatin\b|\bsilk\b|\bchiffon\b|\bgeorgette\b|\btaffeta\b|\borganza\b|\btweed\b|\bcorduroy\b|\bwoven\b|\bkhadi\b|\bcrepe\b/;
  const FIBRE = /\bcotton\b|\bpolyester\b|\bnylon\b|\bviscose\b|\brayon\b|\bwool\b|\bacrylic\b|\bmodal\b|\blyocell\b|\btencel\b/;

  // The share of the stretch fibre if the text gives one: "5% elastane" or "elastane 5%". Returns a number or null.
  function fibrePercent(t) {
    const m = t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s+)?(?:elastane|spandex|lycra|elastodiene|elastomultiester|elasterell)/) ||
              t.match(/(?:elastane|spandex|lycra|elastodiene|elastomultiester|elasterell)\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*%/);
    return m ? parseFloat(m[1]) : null;
  }

  // "high", "medium" or "low" if the text says how much the fabric stretches; the words it used are kept for the explanation.
  function stretchLevel(t) {
    const order = ['high', 'medium', 'low'];
    for (let i = 0; i < order.length; i++) {
      const m = t.match(LEVEL_WORDS[order[i]]);
      if (m) return { level: order[i], words: m[0].replace(/\s+/g, ' ').trim() };
    }
    return null;
  }

  function guessFabric(text) {
    const t = String(text == null ? '' : text).toLowerCase();
    const guess = guessFabricOnly(t);
    if (guess && guess.fabric === 'stretch') {
      const lv = stretchLevel(t);
      guess.level = lv ? lv.level : null;
      guess.levelWhy = lv ? 'the text says "' + lv.words + '"' : null;
    }
    return guess;
  }

  function guessFabricOnly(t) {
    if (!t.trim()) return null;

    // 1. The text says it does not stretch
    if (NO_STRETCH.test(t)) {
      if (ELASTIC_WAIST.test(t)) return { fabric: 'elastic-waist', sure: 'probably', reason: 'the fabric does not stretch, but it has an elastic waist' };
      return { fabric: 'none', sure: 'sure', reason: 'the text says it does not stretch' };
    }

    // 2. A stretch fibre, or the word stretch
    if (STRETCH_FIBRE.test(t)) {
      const pct = fibrePercent(t);
      if (pct !== null && pct < 3) return { fabric: 'stretch', sure: 'probably', reason: 'it lists only ' + pct + '% elastane-type fibre, so a little give. If it feels stiff, choose No stretch or lower the Stretch allowance' };
      return { fabric: 'stretch', sure: 'sure', reason: pct !== null ? 'it lists ' + pct + '% elastane-type fibre' : 'it lists a stretch fibre (elastane, spandex or lycra)' };
    }
    if (STRETCH_WORDS.test(t)) return { fabric: 'stretch', sure: 'probably', reason: 'the text calls it stretchy' };
    if (stretchLevel(t)) return { fabric: 'stretch', sure: 'sure', reason: 'the text says how much it stretches' };

    // 3. A knit fabric
    const knit = t.match(KNIT);
    if (knit) return { fabric: 'stretch', sure: 'probably', reason: '"' + knit[0] + '" is a knit, and knits give' };

    // 4. An elastic waistband
    if (ELASTIC_WAIST.test(t)) return { fabric: 'elastic-waist', sure: 'probably', reason: 'it has an elastic waist, so only the waist gives' };

    // 5. A woven fabric
    const woven = t.match(WOVEN);
    if (woven) return { fabric: 'none', sure: 'probably', reason: '"' + woven[0] + '" is a woven fabric, which does not stretch unless elastane is listed' };

    // 6. Only a fibre name
    const fibre = t.match(FIBRE);
    if (fibre) return { fabric: 'none', sure: 'just a guess', reason: '"' + fibre[0] + '" alone does not say whether the fabric is knit (gives) or woven (does not). Add words like "jersey" or "elastane" if the page has them' };

    return null;
  }

  return { guessFabric };
})();

if (typeof module !== 'undefined') module.exports = FitRoom.Material;
