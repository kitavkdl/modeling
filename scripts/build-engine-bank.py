#!/usr/bin/env python3
"""CC0 오토바이 녹음(freesound 641223·724077)에서 rpm별 엔진음 루프 뱅크를 만든다 (스펙 §4.2)."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import urllib.request
from dataclasses import dataclass
from fractions import Fraction

import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d
from scipy.signal import butter, resample_poly, sosfiltfilt, stft

SR_OUT, SR_TRACK = 44100, 8000      # 출력·추적용 샘플레이트 (Hz)
NPERSEG, HOP = 8192, 800            # 거친 추적 STFT 창·홉 (샘플 @ 8 kHz = 1.024 s, 0.1 s)
F0_MIN, F0_MAX, F0_STEP = 15.0, 230.0, 0.5   # f0 탐색 범위·간격 (Hz)
N_HARM, ENERGY_Q = 6, 0.35          # 배음 가중합 개수 / 이 분위수 이하 에너지 프레임은 무효
MEDIAN_TAPS = 5                     # f0 트랙 중앙값 필터 (프레임) — 옥타브 튐 제거
FINE_NPERSEG, FINE_HOP = 2048, 320  # 정밀 추적 창·홉 (샘플 @ 8 kHz = 0.256 s, 0.04 s)
FINE_HARM, FINE_SPAN, FINE_STEP = 10, 0.15, 0.005   # 배음 수 / 거친 값 대비 탐색 폭 / 비율 격자
STEADY_TOL, STEADY_MIN_S = 0.04, 0.8    # 정속 창 허용 편차 / 최소 길이 (s)
FLAT_TOL = 0.16         # 정밀 트랙 p5~p95 폭이 이보다 크면 "정속처럼 보였을 뿐"으로 본다
PICK_TOL = 0.06         # 목표 rpm 대비 허용 편차
FLATTEN_TOL, FLATTEN_MIN_S = 0.12, 0.6              # 평탄화 재료 허용 편차 / 최소 연속 길이 (s)
FLATTEN_FRAME_S, FLATTEN_OVL_S, FLATTEN_GAP = 0.02, 0.006, 3    # 프레임 홉·이음 (s) / 메울 구멍 (프레임)
FLATTEN_PASSES = 4      # 피치 평탄화 반복 상한 — 재서 남은 만큼 다시 편다
EVEN_WIN_S, EVEN_MAX_DB = 0.15, 6.0     # 조각 안 음량 고르기 창 (s) / 최대 보정 (dB)
LOOP_MIN_S, LOOP_MAX_S, LOOP_FLOOR_S = 1.2, 2.0, 0.5    # 루프 길이 범위 / 재료 부족 시 하한 (s)
XFADE_S = 0.08                      # 루프 이음새 등파워 크로스페이드 (s)
# 정밀 f0 — 루프를 정수 주기로 자르는 기준. 여기서 1% 틀리면 루프마다 위상이 튀어 맥놀이가 된다.
F0_FMAX, F0_SPAN = 2000.0, 0.04     # 최소제곱에 쓰는 배음 상한 (Hz) / 힌트 대비 탐색 폭
F0_NFFT_MIN = 1 << 17               # 제로패딩 rfft 최소 길이
F0_HARM_TOL = 0.006                 # 이만큼 어긋난 피크는 배음이 아니라 이웃 잡음으로 보고 버린다
F0_SETTLE = 2e-4                    # 재단→재측정이 이 안으로 들어오면 굳은 것으로 본다
RES_SPAN = 0.06                             # 프레임별 f0 재탐색 폭 — 정속 창도 몇 %는 흔들린다
RES_FRAME_S, RES_HOP_S = 0.25, 0.05         # 잔류 피치 보고용 창·홉 (s)
RES_FIX_FRAME_S, RES_FIX_HOP_S = 0.12, 0.02 # 평탄화 재측정용 창·홉 (s) — 빠른 흔들림까지 잡는다
RES_MIN_CYCLES = 20                 # 창은 적어도 이만큼의 점화 주기를 담는다. 8주기로 재면 22 Hz
                                    # 아이들에서 추정기 자체의 잡음이 1%다 (한 주기를 그대로 반복해
                                    # 만든 '완벽히 주기적인' 대조 신호로 확인). 20주기면 0.02% 아래.
RES_TARGET, RES_DROP = 0.005, 0.01  # 잔류 피치 목표 / 이보다 크면 루프를 버린다
RATIO_DENOMS, RATIO_TOL = (64, 256, 1024), 2e-5     # 리샘플 비율 유리수 근사 분모 후보 / 허용 오차
ENV_RMS_S, ENV_SMOOTH_S = 0.05, 0.12        # 포락선 RMS 창 / 평활 창 (s) — 3 Hz 이하 출렁임만 남는다
ENV_MAX_DB, ENV_TARGET_DB = 2.0, 1.0        # 포락선 역보정 상한 (dB) / 남은 변동 목표 (dB)
CUT_STEP_S, CUT_ENV_DEC_S = 0.008, 0.01     # 재단 위치 탐색 간격 / 포락선 간축 간격 (s)
CUT_LEN_PENALTY_DB = 0.5    # 짧은 루프에 매기는 벌점 (dB, LOOP_MAX_S 대비 선형) — 비슷하면 긴 쪽
CUT_SHORT_PENALTY_DB = 2.0  # LOOP_MIN_S에 못 미치는 루프에 더 매기는 벌점 (dB)
CUT_SHORTLIST = 80          # 성긴 점수로 추린 뒤 실제로 조립해 다시 줄 세우는 후보 수
CUT_MATERIAL_S = 4.0        # 정속 창에서 가져올 재료 길이 상한 (s) — 길수록 고를 자리가 많다
HP_HZ, HP_ORDER = 30.0, 4           # 하이패스 (Hz, 차수)
TARGET_RMS_DBFS, PEAK_CEIL_DBFS = -18.0, -1.0       # RMS 정규화 목표 / 피크 상한 (dBFS)
VORBIS_LEVEL = 0.55     # libsndfile compression_level; vorbis quality ≈ 1 − level ≈ 0.45
CREDITS = [
    {"id": 641223, "author": "AlexanderChe", "license": "CC0", "url": "https://freesound.org/s/641223/"},
    {"id": 724077, "author": "brucehep", "license": "CC0", "url": "https://freesound.org/s/724077/"},
]
SOURCE_OF = {2250: 724077}          # 목표 rpm → 소스 id (기본 641223)
DEFAULT_SOURCE = 641223


@dataclass
class Track:
    """프레임별 f0 추적 결과 (시각 s, rpm, 유효 여부)."""
    t: np.ndarray
    rpm: np.ndarray
    valid: np.ndarray


# freesound가 기본 urllib UA를 거부할 때를 대비한 브라우저 UA
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36"


def write_ogg(path: str, y: np.ndarray) -> None:
    """OGG/Vorbis로 저장한다. libsndfile에 Vorbis가 없으면 원인을 알리는 오류로 바꾼다."""
    try:
        sf.write(path, y.astype(np.float32), SR_OUT, format="OGG", subtype="VORBIS", compression_level=VORBIS_LEVEL)
    except (RuntimeError, sf.LibsndfileError, ValueError) as e:  # type: ignore[attr-defined]
        raise SystemExit(f"{path}: OGG/Vorbis 인코딩 실패 — libsndfile이 Vorbis를 지원하는지 확인 ({e})") from e


def ensure_input(path: str, sound_id: int) -> str:
    """입력 mp3가 없으면 freesound 페이지에서 HQ 미리듣기 링크를 긁어 내려받는다."""
    if os.path.exists(path):
        return path
    # 기본 UA(Python-urllib)는 봇 필터에 막히므로 브라우저 UA를 붙인다
    def _get(url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()

    page = _get(f"https://freesound.org/s/{sound_id}/").decode("utf8", "replace")
    m = re.search(r"https://cdn\.freesound\.org/previews/\d+/%d_[\w-]*hq\.mp3" % sound_id, page)
    if not m:
        raise RuntimeError(f"{sound_id}: HQ 미리듣기 링크를 찾지 못했다")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"  내려받는 중: {m.group(0)}")
    with open(path, "wb") as f:
        f.write(_get(m.group(0)))
    return path


def load_mono(path: str, sr: int = SR_OUT) -> tuple[np.ndarray, int]:
    """mp3를 모노 float64로 읽고 목표 샘플레이트로 리샘플한다."""
    x, src_sr = sf.read(path, dtype="float64", always_2d=True)
    x = x.mean(axis=1)
    if src_sr != sr:
        g = math.gcd(int(src_sr), int(sr))
        x = resample_poly(x, sr // g, src_sr // g)
    return x, sr


def _median_filter(a: np.ndarray, taps: int) -> np.ndarray:
    """중앙값 필터 (짧은 배열에서도 안전)."""
    if taps <= 1 or len(a) < taps:
        return a
    view = np.lib.stride_tricks.sliding_window_view(np.pad(a, taps // 2, mode="edge"), taps)
    return np.median(view, axis=1)


def _parabolic_offset(score: np.ndarray, best: np.ndarray) -> np.ndarray:
    """점수 최댓값 주변 3점 포물선 보간으로 격자보다 고운 위치(격자 단위 오프셋)를 얻는다."""
    i = np.clip(best, 1, score.shape[0] - 2)
    cols = np.arange(score.shape[1])
    a, b, c = score[i - 1, cols], score[i, cols], score[i + 1, cols]
    den = np.where(np.abs(a - 2 * b + c) > 1e-30, a - 2 * b + c, 1e-30)
    return np.clip(0.5 * (a - c) / den, -0.5, 0.5) + (i - best)


def _spectrogram(x: np.ndarray, sr: int, nperseg: int, hop: int):
    """8 kHz로 내린 뒤 파워 스펙트로그램 (주파수 간격 df, 프레임 시각 t, 파워 p)."""
    g = math.gcd(int(sr), SR_TRACK)
    f, t, z = stft(resample_poly(x, SR_TRACK // g, sr // g), fs=SR_TRACK,
                   nperseg=nperseg, noverlap=nperseg - hop, window="hann")
    return float(f[1] - f[0]), t, np.abs(z) ** 2


def _harmonic_score(p: np.ndarray, df: float, f0s: np.ndarray, nharm: int) -> np.ndarray:
    """f0 후보별 배음 가중합 Σ P(k·f0)/k. f0s는 (후보,) 또는 (후보, 프레임); 스펙트럼은 선형보간한다."""
    cols = np.arange(p.shape[1])
    score = np.zeros((f0s.shape[0], p.shape[1]))
    for k in range(1, nharm + 1):
        pos = np.clip(k * f0s / df, 0, p.shape[0] - 1.001)
        i0 = pos.astype(int)
        w = pos - i0
        lo, hi = (p[i0, cols], p[i0 + 1, cols]) if f0s.ndim == 2 else (p[i0], p[i0 + 1])
        if f0s.ndim == 1:
            w = w[:, None]
        score += ((1.0 - w) * lo + w * hi) / k
    return score


def _power_spectrum(x: np.ndarray, sr: int, nfft: int | None = None) -> tuple[np.ndarray, float]:
    """조각 전체에 한 창을 씌우고 길게 제로패딩한 파워 스펙트럼 (P, 빈 간격 df)."""
    n = len(x)
    if nfft is None:
        nfft = 1 << max(F0_NFFT_MIN.bit_length() - 1, int(math.ceil(math.log2(max(2 * n, 2)))))
    return np.abs(np.fft.rfft(x * np.hanning(n), n=nfft)) ** 2, sr / nfft


def _peak_offset(a: float, b: float, c: float) -> float:
    """3점 포물선 꼭짓점의 격자 단위 오프셋 — 위로 볼록할 때만 움직인다."""
    den = a - 2 * b + c
    return float(np.clip(0.5 * (a - c) / den, -0.5, 0.5)) if den < -1e-30 else 0.0


def _coarse_f0(P: np.ndarray, df: float, hint: float, span: float = F0_SPAN) -> float:
    """Σ_k P(k·f0)/k 가 최대인 f0 — 격자를 세 번 좁혀 가며 포물선 보간한다."""
    def score(f0s: np.ndarray) -> np.ndarray:
        s = np.zeros(len(f0s))
        for k in range(1, max(1, int(F0_FMAX / max(float(f0s[0]), 1e-6))) + 1):
            pos = np.clip(k * f0s / df, 0, len(P) - 1.001)
            i0 = pos.astype(int)
            u = pos - i0
            s += ((1.0 - u) * P[i0] + u * P[i0 + 1]) / k
        return s

    grid = np.linspace(hint * (1 - span), hint * (1 + span), 2001)
    best = float(hint)
    for _ in range(3):
        sc = score(grid)
        i = int(np.clip(np.argmax(sc), 1, len(grid) - 2))
        step = float(grid[1] - grid[0])
        best = float(grid[i]) + _peak_offset(sc[i - 1], sc[i], sc[i + 1]) * step
        grid = np.linspace(best - step, best + step, 201)
    return best


def _refine_f0(P: np.ndarray, df: float, f0: float) -> float:
    """배음마다 피크 주파수를 포물선 보간으로 재고 f_k = k·f0 를 세기 가중 최소제곱으로 푼다.
    가중합만으로는 1차 배음이 지배해 봉우리가 뭉툭하다 — 고차 배음은 지레가 길어 오차를 0.1% 아래로 끌어내린다."""
    logP = np.log(P + 1e-300)
    num = den = 0.0
    for k in range(1, max(2, int(F0_FMAX / max(f0, 1e-6))) + 1):
        c, half = k * f0 / df, 0.4 * f0 / df
        lo, hi = int(max(1, c - half)), int(min(len(P) - 2, c + half))
        if hi <= lo:
            break
        i = int(np.clip(lo + int(np.argmax(P[lo:hi + 1])), 1, len(P) - 2))
        fk = (i + _peak_offset(logP[i - 1], logP[i], logP[i + 1])) * df
        if abs(fk / k - f0) > F0_HARM_TOL * f0:     # 배음이 아니라 사이 잡음을 잡았다
            continue
        w = float(P[i]) / k
        num += w * k * fk
        den += w * k * k
    return f0 if den <= 0 else num / den


def precise_f0(x: np.ndarray, hint_hz: float, sr: int = SR_OUT, span: float = F0_SPAN) -> float:
    """조각 전체의 기본 주파수 (Hz). 합성 신호 실험에서 오차 0.1% 아래."""
    P, df = _power_spectrum(x, sr)
    return _refine_f0(P, df, _coarse_f0(P, df, hint_hz, span))


def pitch_frames(y: np.ndarray, f0: float, sr: int = SR_OUT, frame_s: float = RES_FRAME_S,
                 hop_s: float = RES_HOP_S) -> tuple[np.ndarray, np.ndarray]:
    """프레임별 f0 (프레임 한가운데 시각 s, Hz). 창은 적어도 8 점화 주기를 담는다."""
    frame = max(int(frame_s * sr), int(round(RES_MIN_CYCLES * sr / max(f0, 1e-6))))
    hop = max(1, int(hop_s * sr))
    ts, fs = [], []
    for q in range(0, max(1, len(y) - frame), hop):
        if q + frame > len(y):
            break
        P, df = _power_spectrum(y[q:q + frame], sr)
        ts.append((q + frame / 2) / sr)
        fs.append(_refine_f0(P, df, _coarse_f0(P, df, f0, RES_SPAN)))
    if not fs:
        return np.array([0.0]), np.array([f0])
    return np.array(ts), np.array(fs)


def pitch_residual(y: np.ndarray, f0: float, sr: int = SR_OUT, **kw) -> float:
    """남은 피치 흔들림 — 프레임별 f0의 p5~p95 폭 / 중앙값."""
    _, f = pitch_frames(y, f0, sr, **kw)
    lo, mid, hi = np.percentile(f, [5, 50, 95])
    return float((hi - lo) / max(mid, 1e-9))


def loop_residual(y: np.ndarray, f0: float, sr: int = SR_OUT) -> float:
    """루프의 잔류 피치. 앞 80 ms는 꼬리를 겹쳐 놓은 이음새라 f0 추정이 무의미하므로 건너뛴다 —
    이음새를 넘는 위상 연속성은 정수 주기 재단이 보장하고, 여기서는 루프 안쪽만 본다."""
    return pitch_residual(y[int(XFADE_S * sr):], f0, sr)


def env_db(y: np.ndarray, sr: int = SR_OUT, circular: bool = True) -> np.ndarray:
    """단시간 RMS(50 ms) → 120 ms 평활 → dB. 3 Hz 이하 출렁임만 남고 점화 펄스(≥20 Hz)는 지워진다."""
    mode = "wrap" if circular else "nearest"
    p = uniform_filter1d(y ** 2, size=max(1, int(ENV_RMS_S * sr)), mode=mode)
    p = uniform_filter1d(p, size=max(1, int(ENV_SMOOTH_S * sr)), mode=mode)
    return 10 * np.log10(p + 1e-18)


def env_depth_db(e: np.ndarray) -> float:
    """포락선 변동 폭 (dB, p5~p95)."""
    lo, hi = np.percentile(e, [5, 95])
    return float(hi - lo)


def flatten_envelope(y: np.ndarray, sr: int = SR_OUT) -> np.ndarray:
    """루프 안 느린 음량 출렁임을 ±2 dB 안에서 되돌린다 — 순환 필터라 이음새가 그대로 살아 있다."""
    e = env_db(y, sr)
    return y * 10 ** (np.clip(float(np.median(e)) - e, -ENV_MAX_DB, ENV_MAX_DB) / 20)


def _ratio(local: float, target: float) -> tuple[int, int]:
    """local → target 피치 이동에 쓸 작은 정수비. 분모를 키워 가며 오차 2e-5 안에 드는 첫 근사를 쓴다
    (rpm 정수비를 그대로 쓰면 5491/5520 같은 값이 나와 resample_poly가 수십 배 느려진다)."""
    r = max(local, 1e-9) / max(target, 1e-9)
    frac = Fraction(r).limit_denominator(RATIO_DENOMS[-1])
    for n in RATIO_DENOMS:
        f = Fraction(r).limit_denominator(n)
        if abs(float(f) - r) <= RATIO_TOL * r:
            frac = f
            break
    return max(1, frac.numerator), max(1, frac.denominator)


def track_rpm(x: np.ndarray, sr: int = SR_OUT) -> Track:
    """8 kHz STFT(1.024 s)에서 6배음 가중합이 최대인 f0를 찾아 rpm(=f0·60) 트랙을 만든다."""
    df, t, p = _spectrogram(x, sr, NPERSEG, HOP)
    cands = np.arange(F0_MIN, F0_MAX + 1e-9, F0_STEP)
    score = _harmonic_score(p, df, cands, N_HARM)
    best = np.argmax(score, axis=0)
    f0 = cands[best] + F0_STEP * _parabolic_offset(score, best)
    energy = p.sum(axis=0)
    return Track(t=t, rpm=_median_filter(f0 * 60.0, MEDIAN_TAPS),
                 valid=energy > np.quantile(energy, ENERGY_Q))


def refine_track(x: np.ndarray, coarse: Track, sr: int = SR_OUT) -> Track:
    """거친 트랙 ±15% 안만 0.256 s 창으로 다시 훑어 빠른 스윕까지 따라가는 정밀 rpm 트랙을 만든다."""
    df, t, p = _spectrogram(x, sr, FINE_NPERSEG, FINE_HOP)
    base = np.interp(t, coarse.t, coarse.rpm) / 60.0            # 프레임별 기준 f0 (Hz)
    ratios = np.arange(1.0 - FINE_SPAN, 1.0 + FINE_SPAN + 1e-9, FINE_STEP)
    score = _harmonic_score(p, df, np.outer(ratios, base), FINE_HARM)
    best = np.argmax(score, axis=0)
    rpm = base * 60.0 * (ratios[best] + FINE_STEP * _parabolic_offset(score, best))
    return Track(t=t, rpm=_median_filter(rpm, 3),
                 valid=np.interp(t, coarse.t, coarse.valid.astype(float)) > 0.5)


def _spread(track: Track, t0: float, dur: float) -> float:
    """구간 안 정밀 rpm의 p5~p95 폭 / 중앙값 — 0에 가까울수록 피치가 평탄하다(이상치에 둔감)."""
    m = (track.t >= t0) & (track.t <= t0 + dur) & track.valid
    if m.sum() < 2:
        return float("inf")
    lo, mid, hi = np.percentile(track.rpm[m], [5, 50, 95])
    return float((hi - lo) / max(mid, 1e-9))


def steady_windows(track: Track, tol: float = STEADY_TOL, min_s: float = STEADY_MIN_S) -> list[tuple[float, float, float]]:
    """유효 프레임 중 rpm이 평균 ±tol 안에 머무는 최대 구간들을 (시작 s, 길이 s, rpm)으로 모은다."""
    dt = float(track.t[1] - track.t[0])
    out: list[tuple[float, float, float]] = []
    n = len(track.rpm)
    for i in range(n):
        if not track.valid[i]:
            continue
        lo = hi = track.rpm[i]
        j = i
        while j + 1 < n and track.valid[j + 1]:
            nlo, nhi = min(lo, track.rpm[j + 1]), max(hi, track.rpm[j + 1])
            if (nhi - nlo) > tol * (nhi + nlo):   # (max−min)/mean ≤ 2·tol
                break
            lo, hi, j = nlo, nhi, j + 1
        dur = (j - i + 1) * dt
        if dur >= min_s - 1e-9:
            out.append((float(track.t[i]), float(dur), float(np.mean(track.rpm[i:j + 1]))))
    return out


def pick_windows(windows, target: float, tol: float = PICK_TOL, need_s: float = LOOP_MIN_S + XFADE_S,
                 want_s: float = CUT_MATERIAL_S, limit: int = 3, apart_s: float = 1.0) -> list:
    """목표 rpm에서 tol 안에 들고 루프 한 개분(need_s) 이상인 정속 창을 좋은 순으로 몇 개.
    편차는 1% 단위로만 따진다 — 실제 rpm은 뱅크에 실측값으로 실리므로, 목표에 0.1% 더 가까운 것보다
    길어서 잘라낼 자리가 많은 창이 낫다. 시작 시각이 apart_s 이상 떨어진 것만 골라, 한 프레임씩 민
    같은 자리를 세 번 시도하는 대신 서로 다른 구간을 후보로 삼는다."""
    cands = [w for w in windows if abs(w[2] - target) <= tol * target and w[1] >= need_s - 1e-9]
    cands.sort(key=lambda w: (round(abs(w[2] - target) / target, 2), -min(w[1], want_s)))
    out: list = []
    for w in cands:
        if all(abs(w[0] - o[0]) >= apart_s for o in out):
            out.append(w)
        if len(out) >= limit:
            break
    return out


def _xfade_append(acc: np.ndarray | None, seg: np.ndarray, n: int) -> np.ndarray:
    """등파워 크로스페이드로 두 조각을 이어 붙인다."""
    if acc is None:
        return seg
    n = int(min(n, len(acc), len(seg)))
    if n <= 0:
        return np.concatenate([acc, seg])
    u = np.arange(n) / n
    head = acc[-n:] * np.cos(u * np.pi / 2) + seg[:n] * np.sin(u * np.pi / 2)
    return np.concatenate([acc[:-n], head, seg[n:]])


def _even_level(y: np.ndarray, sr: int) -> np.ndarray:
    """조각 안 느린 음량 출렁임만 ±6 dB 범위에서 고르게 편다 (점화 펄스 구조는 그대로)."""
    n = max(1, int(EVEN_WIN_S * sr))
    env = np.sqrt(uniform_filter1d(y ** 2, size=n, mode="nearest") + 1e-18)
    lim = 10 ** (EVEN_MAX_DB / 20)
    return y * np.clip(np.median(env) / env, 1 / lim, lim)


def _close_gaps(mask: np.ndarray, maxgap: int) -> np.ndarray:
    """추적 지터로 잠깐 끊긴 짧은 구멍을 메워 연속 구간이 쪼개지지 않게 한다."""
    out = mask.copy()
    idx = np.flatnonzero(mask)
    for a, b in zip(idx[:-1], idx[1:]):
        if 1 < b - a <= maxgap + 1:
            out[a:b] = True
    return out


def _flatten_piece(seg: np.ndarray, sr: int, times: np.ndarray, rpms: np.ndarray, target: float):
    """20 ms 프레임마다 (프레임 한가운데 rpm으로) 리샘플해 피치를 target에 맞춰 이어 붙인다.
    프레임은 입력 시각 기준으로 이어 붙으므로 이음새에서 위상이 맞는다 (times는 seg 시작 기준 s)."""
    frame, ovl = int(FLATTEN_FRAME_S * sr), int(FLATTEN_OVL_S * sr)
    out = None
    for q in range(0, len(seg) - frame - ovl, frame):
        local = float(np.interp((q + frame / 2) / sr, times, rpms))
        up, down = _ratio(local, target)
        r = resample_poly(seg[q:q + frame + ovl], up, down)
        out = _xfade_append(out, r, int(ovl * up / down))
    return out


def _flatten_settle(piece: np.ndarray, sr: int, target: float) -> tuple[np.ndarray, float]:
    """평탄화된 조각에 남은 흔들림을 정밀 트래커로 다시 재서 그만큼 더 편다.
    목표(±0.5%)에 들거나 더 나아지지 않으면 멈추고, 남은 편차를 함께 돌려준다."""
    kw = dict(frame_s=RES_FIX_FRAME_S, hop_s=RES_FIX_HOP_S)
    res = pitch_residual(piece, target / 60.0, sr, **kw)
    for _ in range(FLATTEN_PASSES - 1):
        if res <= RES_TARGET:
            break
        t, f = pitch_frames(piece, target / 60.0, sr, **kw)
        # 조각을 이어 붙인 자리에서는 f0 추정이 흐려진다 — 튄 프레임 하나를 그대로 되먹이면
        # 멀쩡한 구간까지 비틀어 놓으므로 중앙값 필터로 걸러 낸다
        again = _flatten_piece(piece, sr, t, _median_filter(f, 5) * 60.0, target)
        if again is None or len(again) < int(FLATTEN_FRAME_S * sr) * 4:
            break
        nxt = pitch_residual(again, target / 60.0, sr, **kw)
        if nxt >= res:
            break
        piece, res = again, nxt
    return piece, res


def flatten_from_sweep(x: np.ndarray, sr: int, track: Track, target: float, need_s: float):
    """스윕 등에서 목표 ±12% 안 연속 구간을 모아 프레임별 리샘플로 피치를 목표에 평탄화한다(2패스)."""
    dt = float(track.t[1] - track.t[0])
    ok = _close_gaps(track.valid & (np.abs(track.rpm - target) <= FLATTEN_TOL * target), FLATTEN_GAP)
    runs, i, n = [], 0, len(ok)
    while i < n:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and ok[j + 1]:
            j += 1
        if (j - i + 1) * dt >= FLATTEN_MIN_S - 1e-9:
            runs.append((i, j))
        i = j + 1
    if not runs:
        return None, []
    runs.sort(key=lambda r: r[0] - r[1])    # 긴 구간부터
    acc, used, ref = None, [], 0.0
    for i, j in runs:
        a, b = int(track.t[i] * sr), int(min(track.t[j] + dt, len(x) / sr) * sr)
        piece = _flatten_piece(x[a:b], sr, track.t[i:j + 1] - track.t[i], track.rpm[i:j + 1], target)
        if piece is None or len(piece) < int(FLATTEN_FRAME_S * sr) * 4:
            continue
        piece, _ = _flatten_settle(piece, sr, target)
        piece = _even_level(piece, sr)
        rms = max(float(np.sqrt(np.mean(piece ** 2))), 1e-12)
        ref = ref or rms                    # 서로 다른 시점의 조각을 같은 레벨로 맞춘다(루프 안 음량 출렁임 방지)
        piece = piece * (ref / rms)
        used.append((track.t[i], (j - i + 1) * dt))
        acc = _xfade_append(acc, piece, int(FLATTEN_OVL_S * sr))
        # 긴 구간부터 쓴다. 한 구간만으로 최소 길이가 나오면 거기서 멈춘다 — 서로 다른 시각의
        # 조각을 이어 붙이면 이은 자리에서 음색이 튀고, 그 자리가 루프마다 되풀이돼 귀에 걸린다.
        if len(acc) >= min(need_s, LOOP_FLOOR_S + XFADE_S) * sr:
            break
    return acc, used


def _normalize(y: np.ndarray) -> tuple[np.ndarray, bool, float]:
    """RMS를 −18 dBFS로 맞추고 필요하면 −1 dBFS로 소프트 리미팅한다."""
    ceil = 10 ** (PEAK_CEIL_DBFS / 20)
    gain = 10 ** (TARGET_RMS_DBFS / 20)
    y = y * (gain / max(float(np.sqrt(np.mean(y ** 2))), 1e-12))
    peak = float(np.max(np.abs(y)))
    limited = peak > ceil
    if limited:
        for _ in range(2):
            y = ceil * np.tanh(y / ceil)
            y = y * (gain / max(float(np.sqrt(np.mean(y ** 2))), 1e-12))
        y = np.clip(y, -ceil, ceil)
    return y, limited, 20 * math.log10(max(peak, 1e-12))


def _highpass(seg: np.ndarray, sr: int, circular: bool = False) -> np.ndarray:
    """30 Hz 4차 버터워스 하이패스 (영위상). circular면 3회 반복 후 가운데만 취해 루프 이음새를 지킨다."""
    sos = butter(HP_ORDER, HP_HZ / (sr / 2), btype="high", output="sos")
    if not circular:
        return sosfiltfilt(sos, seg)
    return sosfiltfilt(sos, np.tile(seg, 3))[len(seg):2 * len(seg)]


def _assemble(seg: np.ndarray, off: int, length: int, xf: int) -> np.ndarray:
    """끝 xf 샘플을 앞 xf 샘플에 등파워로 섞어 길이 length의 이음매 없는 루프를 만든다."""
    x = seg[off:off + length + xf]
    y = x[:length].copy()
    u = np.arange(xf) / xf
    y[:xf] = y[:xf] * np.sin(u * np.pi / 2) + x[length:length + xf] * np.cos(u * np.pi / 2)
    return y


def _seam_db(y: np.ndarray, edge: int) -> float:
    """루프 끝과 처음 edge 샘플의 RMS 차 (dB) — 0에 가까울수록 이음새가 티나지 않는다."""
    head = float(np.sqrt(np.mean(y[:edge] ** 2)))
    tail = float(np.sqrt(np.mean(y[-edge:] ** 2)))
    return 20 * math.log10(max(tail, 1e-12) / max(head, 1e-12))


def _swell_db(e: np.ndarray) -> float:
    """포락선 e(dB)를 ±2 dB 역보정으로 폈을 때 남는 변동 폭 (dB) — 재단 후보를 값싸게 줄 세운다."""
    return env_depth_db(e + np.clip(float(np.median(e)) - e, -ENV_MAX_DB, ENV_MAX_DB))


def _len_penalty(length_s: float) -> float:
    """짧은 루프 벌점 (dB). 짧을수록 되풀이가 자주 들리니 출렁임이 비슷하면 긴 쪽을 쓴다."""
    return (CUT_LEN_PENALTY_DB * max(0.0, LOOP_MAX_S - length_s) / LOOP_MAX_S
            + CUT_SHORT_PENALTY_DB * max(0.0, LOOP_MIN_S - length_s) / LOOP_MIN_S)


def _best_cut(seg: np.ndarray, f0: float, sr: int) -> tuple[int, int]:
    """(주기 수, 잘라낼 위치) 후보를 훑어 '평탄화 뒤 남는 출렁임 + 이음새 단차'가 가장 작은 재단을 고른다.
    무조건 가장 긴 자리를 쓰면 재료의 느린 출렁임을 그대로 안고 가, 루프가 한 바퀴 돌 때마다
    부풀었다 꺼지는 0.5 Hz 맥동이 된다 — 사용자가 말한 '왕(쉬고)왕'이 바로 이것이다."""
    xf, per = int(XFADE_S * sr), sr / f0
    dec = max(1, int(CUT_ENV_DEC_S * sr))
    # 성긴 점수도 하이패스 뒤에서 잰다 — 30 Hz HP가 22 Hz 아이들의 기본파를 깎으면 음량 분포가 달라진다
    e = env_db(_highpass(seg, sr), sr, circular=False)[::dec]   # 10 ms 간격 (출렁임은 3 Hz 이하다)
    avail_s = (len(seg) - xf) / sr
    if avail_s < LOOP_FLOOR_S:
        raise ValueError(f"재료 {avail_s:.2f} s로는 {f0 * 60:.0f} rpm 루프를 만들 수 없다")
    floor_s = LOOP_MIN_S if avail_s >= LOOP_MIN_S else LOOP_FLOOR_S     # 재료가 넉넉하면 짧은 루프는 보지 않는다
    cyc_max, cyc_min = int(min(LOOP_MAX_S, avail_s) * f0), max(1, int(np.ceil(floor_s * f0)))
    best, cands = None, []
    for cyc in range(cyc_max, cyc_min - 1, -1):
        length = int(round(cyc * per))
        if length < LOOP_FLOOR_S * sr or length + xf > len(seg):
            continue
        edge = min(max(int(0.02 * sr), int(per)), length // 4, xf)
        # 이음새는 _assemble과 똑같이 섞어 본 앞 edge와 루프 끝 edge의 RMS 차로 잰다.
        # 정수 주기로 잘랐으니 두 조각은 위상이 맞고, 그래서 겹치면 최대 +3 dB까지 부푼다 —
        # 이 봉우리가 루프마다 되풀이되면 그대로 0.5 Hz 맥동이 된다.
        w = np.arange(edge) / xf * (np.pi / 2)
        sin_w, cos_w = np.sin(w), np.cos(w)
        pen = _len_penalty(length / sr)
        for off in range(0, len(seg) - length - xf + 1, max(1, int(CUT_STEP_S * sr))):
            head = seg[off:off + edge] * sin_w + seg[off + length:off + length + edge] * cos_w
            hp = float(np.mean(head ** 2))
            tp = float(np.mean(seg[off + length - edge:off + length] ** 2))
            seam = abs(10 * math.log10(max(tp, 1e-30) / max(hp, 1e-30)))
            cost = _swell_db(e[off // dec:(off + length) // dec]) + seam + pen
            cands.append((cost, cyc, off, length, edge))
    if not cands:
        raise ValueError(f"재료 {avail_s:.2f} s로는 {f0 * 60:.0f} rpm 루프를 만들 수 없다")
    # 성긴 점수는 크로스페이드도 순환도 무시한다 — 추려 낸 뒤에는 실제로 조립해 정확히 다시 잰다
    cands.sort(key=lambda c: c[0])
    for _, cyc, off, length, edge in cands[:CUT_SHORTLIST]:
        y = flatten_envelope(_highpass(_assemble(seg, off, length, xf), sr, circular=True), sr)
        cost = env_depth_db(env_db(y, sr)) + abs(_seam_db(y, edge)) + _len_penalty(length / sr)
        if best is None or cost < best[0]:
            best = (cost, cyc, off)
    return best[1], best[2]


def make_loop(seg: np.ndarray, rpm_hint: float, sr: int = SR_OUT) -> tuple[np.ndarray, dict]:
    """정밀하게 잰 점화 주기의 정수배로 자르고 끝 80 ms를 앞에 등파워로 섞어 루프를 만든다.
    주기가 0.1%만 어긋나도 루프가 한 바퀴 돌 때마다 위상이 튀어 0.5~2 Hz로 '왕(쉬고)왕' 한다 —
    그래서 힌트로 한 번 자른 뒤 그 조립본에서 f0를 다시 재고, 그 f0로 다시 자른다."""
    xf = int(XFADE_S * sr)
    f0 = precise_f0(seg, rpm_hint / 60.0, sr)       # 360° 병렬 2기통 점화 주기 = 1/f0 (s)
    cycles, off = _best_cut(seg, f0, sr)
    length = int(round(cycles / f0 * sr))
    for i in range(4):                      # 재단 → 재측정이 굳을 때까지 (보통 한 번이면 끝난다)
        length = int(round(cycles / f0 * sr))
        off = min(off, max(0, len(seg) - length - xf))
        raw = _assemble(seg, off, length, xf)
        nxt = precise_f0(raw, f0, sr)
        if i == 3 or abs(nxt - f0) <= F0_SETTLE * f0:
            break                           # 마지막 바퀴에서는 f0를 갱신하지 않는다 — 길이와 반드시 맞춰야 한다
        f0 = nxt
    edge = min(max(int(0.02 * sr), int(sr / f0)), length // 4, xf)   # 이음새 비교 구간 (점화 1주기, ≥20 ms)
    # 포락선은 하이패스 뒤에 편다 — 30 Hz HP는 22 Hz 아이들의 기본파를 깎아 내며 음량 분포를
    # 바꿔 놓으므로, 실제로 내보낼 신호에서 재고 펴야 한다. 순환 필터라 이음새는 그대로다.
    hp = _highpass(raw, sr, circular=True)
    before = env_db(hp, sr)
    y, limited, peak_db = _normalize(flatten_envelope(hp, sr))
    return y, {
        "f0": f0,
        "len_s": length / sr,
        "cycles": cycles,
        "off_s": off / sr,
        "seam_db": _seam_db(y, edge),
        "limited": limited,
        "peak_db": peak_db,
        "short": length / sr < LOOP_MIN_S,
        "env_before": before,
        "env_after": env_db(y, sr),
        "raw": raw,     # 하이패스 전 신호 — f0·잔류 피치는 여기서 잰다 (22 Hz 아이들 기본파 보존)
    }


def _shape(seg: np.ndarray, sr: int, fade_out_s: float) -> tuple[np.ndarray, bool]:
    """원샷용: 하이패스 + 5 ms 페이드인 + 지정 페이드아웃 + 같은 정규화."""
    y = _highpass(seg, sr).copy()
    a = min(int(0.005 * sr), len(y))
    y[:a] *= np.linspace(0.0, 1.0, a)
    b = min(int(fade_out_s * sr), len(y))
    y[-b:] *= np.linspace(1.0, 0.0, b)
    y, limited, peak_db = _normalize(y)
    return y, (peak_db if limited else 0.0)


def extract_oneshots(x: np.ndarray, sr: int, track: Track) -> dict:
    """641223에서 시동(크랭킹→점화 0.4 s 후)과 정지(마지막 rpm>800부터 1.2 s) 원샷을 뽑는다."""
    win_lag = NPERSEG / SR_TRACK / 2        # STFT 창 절반 — 상승 에지가 프레임에 미리 비치는 만큼 보정 (s)
    hot = track.valid & (track.rpm > 1000.0)
    run = np.convolve(hot.astype(int), np.ones(10, int), mode="valid")   # 1.0 s 연속 지속 요구
    fire = np.flatnonzero(run == 10)
    if len(fire) == 0:
        raise ValueError("점화 시점을 찾지 못했다")
    t_fire = float(track.t[fire[0]]) + win_lag
    hop = int(0.05 * sr)                                    # 50 ms RMS 엔벨로프
    nfr = len(x) // hop
    env = 20 * np.log10(np.sqrt((x[:nfr * hop].reshape(nfr, hop) ** 2).mean(axis=1)) + 1e-12)
    fi = min(int(t_fire / 0.05), nfr - 1)
    floor_db = float(np.percentile(env[:fi], 10)) if fi > 4 else float(env.min())
    thr = floor_db + 8.0                                    # 크랭킹 판정 문턱 (dB)
    ci = fi
    while ci > 0 and env[ci - 1] > thr and (fi - ci) * 0.05 < 2.5:
        ci -= 1
    t_end = min(t_fire + 0.4, len(x) / sr)
    t_start = max(ci * 0.05, t_end - 2.5)
    start, s_lim = _shape(x[int(t_start * sr):int(t_end * sr)], sr, 0.05)

    tail_from = max(0.0, len(x) / sr - 20.0)                # 마지막 20 s 안에서 정지 탐색
    late = np.flatnonzero(track.valid & (track.rpm > 800.0) & (track.t >= tail_from))
    if len(late) == 0:
        raise ValueError("정지 시점을 찾지 못했다")
    t_stop = float(track.t[late[-1]])
    stop, p_lim = _shape(x[int(t_stop * sr):int(min(t_stop + 1.2, len(x) / sr) * sr)], sr, 0.1)
    return {"start": (start, t_start, t_end - t_start, s_lim), "stop": (stop, t_stop, len(stop) / sr, p_lim)}


def measure_rpm(y: np.ndarray, sr: int = SR_OUT) -> float:
    """만들어진 루프를 4 s 이상으로 반복해 다시 추적, 실측 rpm(중앙값)을 낸다."""
    reps = max(1, int(np.ceil(4.0 * sr / len(y))))
    tr = track_rpm(np.tile(y, reps), sr)
    sel = tr.rpm[tr.valid] if tr.valid.any() else tr.rpm
    return float(np.median(sel))


def _plot(path: str, items: list[tuple[str, np.ndarray, float]], sr: int = SR_OUT) -> None:
    """각 루프·원샷의 스펙트로그램(0~1.5 kHz)을 한 장에 그린다 — 배음이 수평이면 정상."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cols = 3
    rows = int(np.ceil(len(items) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(4.6 * cols, 2.6 * rows), squeeze=False)
    for ax, (name, y, rpm) in zip(axes.ravel(), items):
        yy = np.tile(y, 2) if len(y) / sr < 2.0 else y
        f, t, z = stft(yy, fs=sr, nperseg=4096, noverlap=4096 - 512, window="hann")
        keep = f <= 1500
        ax.pcolormesh(t, f[keep], 20 * np.log10(np.abs(z[keep]) + 1e-10), shading="auto", cmap="magma")
        if rpm > 0:
            for k in range(1, 8):
                ax.axhline(k * rpm / 60.0, color="cyan", lw=0.4, alpha=0.5)
        ax.set_title(f"{name}  ({rpm:.0f} rpm, f0={rpm / 60:.1f} Hz)" if rpm > 0 else name, fontsize=9)
        ax.set_ylabel("Hz", fontsize=7)
        ax.tick_params(labelsize=6)
    for ax in axes.ravel()[len(items):]:
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    print(f"  스펙트로그램: {path}")


def build_loop(x: np.ndarray, fine: Track, sid: int, target: int, win, need: float):
    """정속 창(win) 하나 또는 스윕 평탄화로 재료를 모아 루프 하나를 만든다. 재료가 없으면 None.
    돌려주는 info에는 판정에 쓰는 실측값(정밀 rpm·잔류 피치·포락선 깊이)이 들어 있다."""
    if win is not None:
        a, span = int(win[0] * SR_OUT), min(win[1], CUT_MATERIAL_S)
        seg, rpm_hint = x[a:a + int(span * SR_OUT)], win[2]
        where, method = f"{sid} @{win[0]:.1f}s/{span:.2f}s", "steady"
    else:
        seg, used = flatten_from_sweep(x, SR_OUT, fine, float(target), need)
        if seg is None:
            return None
        rpm_hint, method = float(target), "flattened"
        where = f"{sid} @" + "+".join(f"{u[0]:.1f}s/{u[1]:.2f}s" for u in used)
    # 어느 길로 왔든 재료를 다 모은 뒤 한 번 더 재서 편다. 거친 트래커에 정속으로 보였던 창도
    # 실제로는 2~4% 흔들리고, 스윕 쪽은 조각을 이어 붙인 자리에서 조각 사이 차이가 남는다.
    seg, _ = _flatten_settle(seg, SR_OUT, rpm_hint)
    try:
        y, info = make_loop(seg, rpm_hint)
    except ValueError as exc:
        info = {"error": str(exc)}
        return None, info, where, method
    info["res"] = loop_residual(info["raw"], info["f0"])
    info["env"] = (env_depth_db(info["env_before"]), env_depth_db(info["env_after"]))
    info["old_rpm"] = measure_rpm(info["raw"])      # 예전 추정(거친 트래커 + 10 rpm 반올림) — 비교용
    info["rpm"] = info["f0"] * 60.0
    return y, info, where, method


def _plot_env(path: str, items: list[tuple[str, np.ndarray, np.ndarray]], sr: int = SR_OUT) -> None:
    """루프별 단시간 RMS 포락선(dB, 각자의 중앙값 기준)을 평탄화 전후로 겹쳐 그린다 — 평평할수록 좋다."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    cols = 3
    rows = int(np.ceil(len(items) / cols))
    fig, axes = plt.subplots(rows, cols, figsize=(4.6 * cols, 2.2 * rows), squeeze=False)
    for ax, (name, before, after) in zip(axes.ravel(), items):
        for e, label, color in ((before, "before", "tab:red"), (after, "after", "tab:blue")):   # 폰트에 한글이 없다
            ax.plot(np.arange(len(e)) / sr, e - float(np.median(e)), color=color, lw=0.8,
                    label=f"{label} ({env_depth_db(e):.2f} dB)")
        ax.axhline(0, color="0.7", lw=0.5)
        ax.set_ylim(-4, 4)
        ax.set_title(name, fontsize=9)
        ax.set_ylabel("dB", fontsize=7)
        ax.tick_params(labelsize=6)
        ax.legend(fontsize=6, loc="upper right")
    for ax in axes.ravel()[len(items):]:
        ax.axis("off")
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    print(f"  포락선: {path}")


def main(argv=None) -> int:
    """입력 mp3에서 목표 rpm별 루프·원샷·bank.json을 만들고 검수표를 출력한다."""
    ap = argparse.ArgumentParser(description="엔진음 뱅크 생성 (스펙 §4.2)")
    ap.add_argument("--in", dest="indir", default="ninja400/audio", help="원본 mp3 디렉터리")
    ap.add_argument("--out", dest="outdir", default="public/audio/ninja400/engine", help="출력 디렉터리")
    ap.add_argument("--plot", default=None, help="스펙트로그램 PNG 경로")
    ap.add_argument("--targets", default="1320,2250,2760,3750,4100,4620,5520,6500,7500", help="목표 rpm 목록")
    args = ap.parse_args(argv)
    targets = [int(v) for v in args.targets.split(",") if v.strip()]
    os.makedirs(args.outdir, exist_ok=True)

    src: dict[int, tuple[np.ndarray, Track, Track]] = {}
    for sid in sorted({SOURCE_OF.get(t, DEFAULT_SOURCE) for t in targets} | {DEFAULT_SOURCE}):
        path = ensure_input(os.path.join(args.indir, f"{sid}.mp3"), sid)
        x, _ = load_mono(path)
        tr = track_rpm(x)
        src[sid] = (x, tr, refine_track(x, tr))
        lows = [w for w in steady_windows(tr) if w[2] < 2000]        # 아이들 보정 확인: 가장 긴 저회전 정속 창
        idle = max(lows, key=lambda w: w[1]) if lows else None
        print(f"{sid}: {len(x) / SR_OUT:.1f} s, 유효 프레임 {tr.valid.mean() * 100:.0f}%, 아이들 추정 "
              + (f"{idle[2]:.0f} rpm (@{idle[0]:.1f}s, {idle[1]:.1f}s)" if idle else "없음"))

    rows, loops, plots, envs = [], [], [], []
    for target in targets:
        sid = SOURCE_OF.get(target, DEFAULT_SOURCE)
        x, tr, fine = src[sid]
        need = LOOP_MAX_S + XFADE_S
        # 정속 창 후보를 좋은 순으로, 마지막에 스윕 평탄화를 붙인다 — 흔들려 떨어지면 다음 재료로 넘어간다
        wins = [w for w in pick_windows(steady_windows(tr), target)
                if _spread(fine, w[0], min(w[1], need)) <= FLAT_TOL]   # 긴 창(1.024 s) 탓에 정속으로 보였을 뿐
        best = None
        for win in [*wins, None]:
            got = build_loop(x, fine, sid, target, win, need)
            if got is None:
                print(f"! {target} rpm 재료 없음: ±{FLATTEN_TOL:.0%} 안에 {FLATTEN_MIN_S} s 이상 구간이 없다")
                continue
            y, info, where, method = got
            if y is None:
                print(f"! {target} rpm 후보 버림: {info['error']}")
                continue
            print(f"  {target}: rpm {round(info['old_rpm'] / 10.0) * 10:.0f}(옛) → {info['rpm']:.1f}"
                  f"(정밀, f0 {info['f0']:.4f} Hz), {info['cycles']}주기 {info['len_s']:.4f}s, "
                  f"잔류 피치 {info['res'] * 100:.2f}%, 포락선 {info['env'][0]:.2f}→{info['env'][1]:.2f} dB, "
                  f"{method} {where}")
            if abs(info["rpm"] - target) > PICK_TOL * target:
                print(f"    → 실측 {info['rpm']:.0f} rpm이 ±{PICK_TOL:.0%}를 벗어났다")
                continue
            if best is None or info["res"] < best[1]["res"]:
                best = got
            if info["res"] <= RES_TARGET:
                break       # 충분히 조용하면 여기서 끝낸다. 아니면 남은 후보도 만들어 보고 제일 나은 것을 쓴다
        if best is None:
            print(f"! {target} rpm 제외: 쓸 만한 재료가 없다")
            continue
        y, info, where, method = best
        if info["res"] > RES_DROP:
            # 런타임은 사다리가 단조롭기만 하면 되므로 흔들리는 칸은 지우는 편이 낫다
            print(f"! {target} rpm 제외: 잔류 피치 {info['res'] * 100:.2f}%가 {RES_DROP:.0%}를 넘었다")
            continue
        rpm = info["rpm"]
        name = f"{target}.ogg"
        write_ogg(os.path.join(args.outdir, name), y)
        loops.append({"rpm": round(rpm, 1), "file": name})
        rows.append((target, rpm, where, info, method))
        plots.append((name, y, rpm))
        envs.append((name, info["env_before"], info["env_after"]))

    shots = extract_oneshots(src[DEFAULT_SOURCE][0], SR_OUT, src[DEFAULT_SOURCE][1])
    for key, fade in (("start", 0.05), ("stop", 0.1)):
        y, t0, dur, lim = shots[key]
        write_ogg(os.path.join(args.outdir, f"{key}.ogg"), y)
        print(f"{key}.ogg: {DEFAULT_SOURCE} @{t0:.2f}s, {len(y) / SR_OUT:.2f}s, 페이드아웃 {fade * 1000:.0f} ms"
              + (f", 리미팅 적용(정규화 직후 피크 {lim:+.1f} dBFS)" if lim else ""))
        plots.append((f"{key}.ogg", y, 0.0))

    loops.sort(key=lambda d: d["rpm"])
    bank = {"loops": loops, "start": "start.ogg", "stop": "stop.ogg", "credits": CREDITS}
    with open(os.path.join(args.outdir, "bank.json"), "w", encoding="utf8") as fp:
        json.dump(bank, fp, ensure_ascii=False, indent=2)
        fp.write("\n")

    keep = {d["file"] for d in loops} | {"bank.json", "start.ogg", "stop.ogg"}
    for f in sorted(os.listdir(args.outdir)):       # 이번에 버려진 칸의 옛 파일을 남겨 두지 않는다
        if f.endswith(".ogg") and f not in keep:
            os.remove(os.path.join(args.outdir, f))
            print(f"  옛 파일 삭제: {f}")

    print(f"\n{'목표':>6} {'실측':>8} {'편차':>7}  {'출처·구간':<34} {'길이':>7} {'주기':>5} {'이음새':>8} "
          f"{'잔류':>6} {'포락선(전→후)':>14}  방법")
    for target, rpm, where, info, method in rows:
        print(f"{target:6d} {rpm:8.1f} {(rpm - target) / target * 100:+6.2f}%  {where:<34} "
              f"{info['len_s']:6.3f}s {info['cycles']:5d} {info['seam_db']:+7.2f}dB {info['res'] * 100:5.2f}% "
              f"{info['env'][0]:6.2f}→{info['env'][1]:5.2f}dB  {method}"
              + ("  [짧음]" if info["short"] else "")
              + (f"  [출렁임 {ENV_TARGET_DB:.0f}dB 초과]" if info["env"][1] > ENV_TARGET_DB else "")
              + (f"  [리미팅 {info['peak_db']:+.1f}dBFS]" if info["limited"] else ""))
    total = sum(os.path.getsize(os.path.join(args.outdir, f)) for f in os.listdir(args.outdir))
    for f in sorted(os.listdir(args.outdir)):
        print(f"  {f:>12}  {os.path.getsize(os.path.join(args.outdir, f)) / 1024:7.1f} KB")
    print(f"총 {total / 1024:.1f} KB ({'OK' if total <= 1024 * 1024 else '1 MB 초과!'})")

    if args.plot:
        _plot(args.plot, plots)
        root, ext = os.path.splitext(args.plot)
        _plot_env(f"{root}-env{ext or '.png'}", envs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
