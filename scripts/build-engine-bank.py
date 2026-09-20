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
FLATTEN_FRAME_S, FLATTEN_OVL_S, FLATTEN_GAP = 0.04, 0.008, 3    # 프레임 홉·이음 (s) / 메울 구멍 (프레임)
EVEN_WIN_S, EVEN_MAX_DB = 0.15, 6.0     # 조각 안 음량 고르기 창 (s) / 최대 보정 (dB)
LOOP_MIN_S, LOOP_MAX_S, LOOP_FLOOR_S = 1.2, 2.0, 0.5    # 루프 길이 범위 / 재료 부족 시 하한 (s)
XFADE_S = 0.08                      # 루프 이음새 등파워 크로스페이드 (s)
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


def ensure_input(path: str, sound_id: int) -> str:
    """입력 mp3가 없으면 freesound 페이지에서 HQ 미리듣기 링크를 긁어 내려받는다."""
    if os.path.exists(path):
        return path
    page = urllib.request.urlopen(f"https://freesound.org/s/{sound_id}/", timeout=30).read().decode("utf8", "replace")
    m = re.search(r"https://cdn\.freesound\.org/previews/\d+/%d_[\w-]*hq\.mp3" % sound_id, page)
    if not m:
        raise RuntimeError(f"{sound_id}: HQ 미리듣기 링크를 찾지 못했다")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    print(f"  내려받는 중: {m.group(0)}")
    urllib.request.urlretrieve(m.group(0), path)
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


def _loop_spread(y: np.ndarray, rpm: float, sr: int = SR_OUT) -> float:
    """만들어진 루프 안에서 남은 피치 흔들림."""
    hint = Track(np.array([0.0, len(y) / sr]), np.array([rpm, rpm]), np.array([True, True]))
    return _spread(refine_track(y, hint, sr), 0.0, len(y) / sr)


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


def pick_window(windows, target: float, tol: float = PICK_TOL,
                need_s: float = LOOP_MIN_S + XFADE_S, want_s: float = LOOP_MAX_S + XFADE_S):
    """목표 rpm에서 tol 안에 들고 루프 한 개분(need_s) 이상인 정속 창 중 편차 최소(동률이면 긴) 것."""
    cands = [w for w in windows if abs(w[2] - target) <= tol * target and w[1] >= need_s - 1e-9]
    if not cands:
        return None
    return min(cands, key=lambda w: (round(abs(w[2] - target) / target, 3), -min(w[1], want_s)))


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
    """40 ms 프레임마다 resample_poly로 피치를 target에 맞춰 이어 붙인다 (times는 seg 시작 기준 s)."""
    frame, ovl = int(FLATTEN_FRAME_S * sr), int(FLATTEN_OVL_S * sr)
    out = None
    for q in range(0, len(seg) - frame - ovl, frame):
        local = float(np.interp(q / sr, times, rpms))
        up, down = max(1, int(round(local))), int(round(target))
        g = math.gcd(up, down)
        r = resample_poly(seg[q:q + frame + ovl], up // g, down // g)
        out = _xfade_append(out, r, int(ovl * local / target))
    return out


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
        spread = _loop_spread(piece, target, sr)
        if spread > 2 * STEADY_TOL:         # 남은 흔들림이 크면 평탄화된 결과를 다시 재서 한 번 더 편다
            hint = Track(np.array([0.0, len(piece) / sr]), np.array([target, target]), np.array([True, True]))
            ft = refine_track(piece, hint, sr)
            again = _flatten_piece(piece, sr, ft.t, ft.rpm, target)
            if again is not None and _loop_spread(again, target, sr) < spread:
                piece = again
        piece = _even_level(piece, sr)
        rms = max(float(np.sqrt(np.mean(piece ** 2))), 1e-12)
        ref = ref or rms                    # 서로 다른 시점의 조각을 같은 레벨로 맞춘다(루프 안 음량 출렁임 방지)
        piece = piece * (ref / rms)
        used.append((track.t[i], (j - i + 1) * dt))
        acc = _xfade_append(acc, piece, int(FLATTEN_OVL_S * sr))
        if len(acc) >= need_s * sr:
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


def make_loop(seg: np.ndarray, rpm: float, sr: int = SR_OUT) -> tuple[np.ndarray, dict]:
    """점화 주기 정수배로 자르고 끝 80 ms를 앞에 등파워로 섞어 이음새 없는 루프를 만든다."""
    period = 60.0 / rpm                     # 360° 병렬 2기통 점화 주기 (s)
    xf = int(XFADE_S * sr)
    avail_s = (len(seg) - xf) / sr
    cycles = int(min(LOOP_MAX_S, avail_s) / period)
    length = int(round(cycles * period * sr))
    if cycles < 1 or length / sr < LOOP_FLOOR_S:
        raise ValueError(f"재료 {avail_s:.2f} s로는 {rpm:.0f} rpm 루프를 만들 수 없다")
    edge = min(max(int(0.02 * sr), int(period * sr)), length // 4)   # 이음새 비교 구간 (점화 1주기, ≥20 ms)
    slack = max(0, len(seg) - (length + xf))
    step = max(1, int(0.001 * sr))          # 1 ms 간격으로 잘라낼 위치를 훑어 이음새가 가장 고른 곳을 고른다
    offs = list(range(0, slack + 1, step)) or [0]
    off = min(offs, key=lambda o: abs(_seam_db(_assemble(seg, o, length, xf), edge)))
    raw = _assemble(seg, off, length, xf)   # 하이패스 전 신호 — 실측 rpm은 여기서 잰다(22 Hz 아이들 기본파 보존)
    y, limited, peak_db = _normalize(_highpass(raw, sr, circular=True))
    return y, {
        "len_s": length / sr,
        "cycles": cycles,
        "off_s": off / sr,
        "seam_db": _seam_db(y, edge),
        "limited": limited,
        "peak_db": peak_db,
        "short": length / sr < LOOP_MIN_S,
        "raw": raw,
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

    rows, loops, plots = [], [], []
    for target in targets:
        sid = SOURCE_OF.get(target, DEFAULT_SOURCE)
        x, tr, fine = src[sid]
        need = LOOP_MAX_S + XFADE_S
        win = pick_window(steady_windows(tr), target)
        if win is not None and _spread(fine, win[0], min(win[1], need)) > FLAT_TOL:
            win = None                      # 긴 창(1.024 s) 탓에 정속으로 보였을 뿐 — 평탄화로 넘긴다
        method, where = "steady", ""
        if win is not None:
            a = int(win[0] * SR_OUT)
            seg = x[a:a + int(min(win[1], need + 0.5) * SR_OUT)]
            rpm_hint, where = win[2], f"{sid} @{win[0]:.1f}s/{min(win[1], need + 0.5):.2f}s"
        else:
            seg, used = flatten_from_sweep(x, SR_OUT, fine, target, need)
            method, rpm_hint = "flattened", float(target)
            if seg is None:
                print(f"! {target} rpm 제외: ±{FLATTEN_TOL:.0%} 안에 {FLATTEN_MIN_S} s 이상 재료가 없다")
                continue
            where = f"{sid} @" + "+".join(f"{u[0]:.1f}s/{u[1]:.2f}s" for u in used)
        try:
            y, info = make_loop(seg, rpm_hint)
        except ValueError as exc:
            print(f"! {target} rpm 제외: {exc}")
            continue
        got = measure_rpm(info["raw"])
        wob = _loop_spread(y, got)
        if abs(got - target) > PICK_TOL * target:
            print(f"! {target} rpm 제외: 실측 {got:.0f} rpm이 ±{PICK_TOL:.0%}를 벗어났다")
            continue
        name = f"{target}.ogg"
        sf.write(os.path.join(args.outdir, name), y.astype(np.float32), SR_OUT,
                 format="OGG", subtype="VORBIS", compression_level=VORBIS_LEVEL)
        loops.append({"rpm": int(round(got / 10.0) * 10), "file": name})
        info["wobble"] = wob
        rows.append((target, got, where, info, method))
        plots.append((name, y, got))

    shots = extract_oneshots(src[DEFAULT_SOURCE][0], SR_OUT, src[DEFAULT_SOURCE][1])
    for key, fade in (("start", 0.05), ("stop", 0.1)):
        y, t0, dur, lim = shots[key]
        sf.write(os.path.join(args.outdir, f"{key}.ogg"), y.astype(np.float32), SR_OUT,
                 format="OGG", subtype="VORBIS", compression_level=VORBIS_LEVEL)
        print(f"{key}.ogg: {DEFAULT_SOURCE} @{t0:.2f}s, {len(y) / SR_OUT:.2f}s, 페이드아웃 {fade * 1000:.0f} ms"
              + (f", 리미팅 적용(정규화 직후 피크 {lim:+.1f} dBFS)" if lim else ""))
        plots.append((f"{key}.ogg", y, 0.0))

    loops.sort(key=lambda d: d["rpm"])
    bank = {"loops": loops, "start": "start.ogg", "stop": "stop.ogg", "credits": CREDITS}
    with open(os.path.join(args.outdir, "bank.json"), "w", encoding="utf8") as fp:
        json.dump(bank, fp, ensure_ascii=False, indent=2)
        fp.write("\n")

    print(f"\n{'목표':>6} {'실측':>6} {'편차':>7}  {'출처·구간':<34} {'길이':>6} {'주기':>5} {'이음새':>8} {'흔들림':>7}  방법")
    for target, got, where, info, method in rows:
        print(f"{target:6d} {got:6.0f} {(got - target) / target * 100:+6.2f}%  {where:<34} "
              f"{info['len_s']:5.2f}s {info['cycles']:5d} {info['seam_db']:+7.2f}dB {info['wobble'] * 100:6.1f}%  {method}"
              + ("  [짧음]" if info["short"] else "")
              + (f"  [리미팅 {info['peak_db']:+.1f}dBFS]" if info["limited"] else ""))
    total = sum(os.path.getsize(os.path.join(args.outdir, f)) for f in os.listdir(args.outdir))
    for f in sorted(os.listdir(args.outdir)):
        print(f"  {f:>12}  {os.path.getsize(os.path.join(args.outdir, f)) / 1024:7.1f} KB")
    print(f"총 {total / 1024:.1f} KB ({'OK' if total <= 1024 * 1024 else '1 MB 초과!'})")

    if args.plot:
        _plot(args.plot, plots)
    return 0


if __name__ == "__main__":
    sys.exit(main())
