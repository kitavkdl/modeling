// 생성 파일 — scripts/prepare-ride-model.mjs가 만든다. 손으로 고치지 않는다.
// 실물 모델(Kawasaki ninja ZX-6R · valvetin · CC-BY-4.0)을 저장소 좌표계로 구운 결과. 단위는 mm.
export const RIDE_MODEL = {
  /** 축간거리 (mm) */
  wheelbaseMm: 1370,
  /** 앞 액슬 중심과 타이어 반지름 (mm) */
  front: { x: 685, y: 287.3, r: 287.3 },
  /** 뒤 액슬 중심과 타이어 반지름 (mm) */
  rear: { x: -685, y: 299, r: 299 },
  /** 전체 바운딩박스 (mm) */
  boundsMm: { min: [-981.9, 0.0, -420.6], max: [974.4, 1071.5, 420.6] },
  /** 상호작용 지점의 bbox 중심 (mm) */
  landmarksMm: {
    keyHole: [447.2, 918.0, -42.8],
    buttonRight: [576.4, 846.8, 180.7],
    gripRight: [396.4, 850.9, 264.5],
    dashboard: [589.2, 924.5, -1.4],
  },
  source: {
    name: 'Kawasaki ninja ZX-6R',
    author: 'valvetin',
    url: 'https://sketchfab.com/3d-models/kawasaki-ninja-zx-6r-4af2b6840b8045a5af5e8df8a85f04fa',
    license: 'CC-BY-4.0',
  },
} as const
