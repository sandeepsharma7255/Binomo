
const axios = require('axios');

function calcEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((a,b)=>a+b,0) / period;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcRSI(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i-1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i-1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function fetchKlines(symbol, interval, limit){
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const r = await axios.get(url, { timeout: 10000 });
  return r.data;
}

function combineWeighted(seriesArr, weights){
  const len = seriesArr[0].length;
  const out = new Array(len).fill(0);
  let wsum = weights.reduce((a,b)=>a+b,0) || 1;
  for (let i = 0; i < len; i++){
    let s = 0;
    for (let j = 0; j < seriesArr.length; j++){
      s += (seriesArr[j][i] || 0) * (weights[j] || 0);
    }
    out[i] = s / wsum;
  }
  return out;
}

exports.handler = async (event) => {
  try {
    const q = event.queryStringParameters || {};
    const mode = (q.mode || "synthetic").toLowerCase();
    const interval = q.interval || "1m";
    const limit = parseInt(q.limit || "100", 10);

    if (mode === "pair") {
      const symbol = (q.symbol || "BTCUSDT").toUpperCase();
      const k = await fetchKlines(symbol, interval, limit);
      const closes = k.map(r => parseFloat(r[4]));
      const ema12 = calcEMA(closes, 12);
      const ema26 = calcEMA(closes, 26);
      const rsi = calcRSI(closes, 14);
      const last = k[k.length - 1];
      const bull = parseFloat(last[4]) > parseFloat(last[1]);
      let signal = "HOLD";
      if (ema12 > ema26 && rsi > 40 && rsi < 80 && bull) signal = "CALL";
      else if (ema12 < ema26 && rsi > 20 && rsi < 60 && !bull) signal = "PUT";
      return { statusCode: 200, body: JSON.stringify({ mode: "pair", symbol, signal, indicators: { ema12, ema26, rsi }, lastCandle: { open: parseFloat(last[1]), close: parseFloat(last[4]), isBull: bull }, timestamp: new Date().toISOString() }) };
    }

    const syms = q.symbols ? q.symbols.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean) : ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT'];
    const weights = q.weights ? q.weights.split(',').map(w=>parseFloat(w)) : [0.55,0.25,0.12,0.08];

    const arr = [];
    for (const s of syms) {
      const k = await fetchKlines(s, interval, limit);
      arr.push(k.map(r => parseFloat(r[4])));
    }
    const combined = combineWeighted(arr, weights);
    const ema12 = calcEMA(combined, 12);
    const ema26 = calcEMA(combined, 26);
    const rsi = calcRSI(combined, 14);
    const last = combined[combined.length - 1];
    const prev = combined[combined.length - 2];
    const bull = last > prev;
    let signal = "HOLD";
    if (ema12 > ema26 && rsi > 40 && rsi < 80 && bull) signal = "CALL";
    else if (ema12 < ema26 && rsi > 20 && rsi < 60 && !bull) signal = "PUT";

    return { statusCode: 200, body: JSON.stringify({ mode: "synthetic", basedOn: syms.map((s,i)=>({symbol:s,weight:weights[i]||0})), signal, indicators: { ema12, ema26, rsi }, lastCombinedCandle: { prev, last, isBull: bull }, timestamp: new Date().toISOString() }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) };
  }
};
