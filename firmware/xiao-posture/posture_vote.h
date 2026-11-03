// 별일없지 — XIAO 자세 인식: 최근 N프레임 다수결 (순수 C++, 하드웨어 의존성 없음).
//
// 규칙:
//   - confidence < minConfidence 프레임은 버린다 (투표에 넣지 않음).
//   - 버퍼가 N프레임 차고, 한 자세가 과반(> N/2)이면 그 자세로 "확정".
//   - 확정 자세가 직전 확정과 다를 때만 전송 (send=true).
//   - no_person 확정은 전송하지 않는다 (직전 확정값만 no_person 으로 갱신 →
//     사람이 다시 보이면 그 자세를 전송한다).
//   - posture_vote_reset() (방 전환 직후) → 직전 확정값이 지워지므로
//     첫 확정 자세는 직전 방과 같아도 바로 전송한다.
//
// tests/posture_vote_test.cpp 에서 g++ 로 단위 테스트한다.
#pragma once

#include <stdint.h>

enum Posture : int8_t {
  POSTURE_UNKNOWN = -1,
  POSTURE_STANDING = 0,
  POSTURE_SITTING = 1,
  POSTURE_LYING = 2,
  POSTURE_NO_PERSON = 3,
};

static const int POSTURE_CLASS_COUNT = 4;
static const int POSTURE_VOTE_MAX_FRAMES = 15;

/** Worker 가 받는 posture 문자열. no_person / unknown 은 전송 대상이 아니므로 nullptr */
inline const char *posture_api_name(Posture p) {
  switch (p) {
    case POSTURE_STANDING: return "standing";
    case POSTURE_SITTING: return "sitting";
    case POSTURE_LYING: return "lying";
    default: return nullptr;
  }
}

struct PostureVoter {
  int windowSize;
  float minConfidence;
  Posture frames[POSTURE_VOTE_MAX_FRAMES];
  float confidences[POSTURE_VOTE_MAX_FRAMES];
  int count;  // 채워진 프레임 수 (<= windowSize)
  int head;   // 다음에 쓸 위치 (원형 버퍼)
  Posture lastConfirmed;
};

struct VoteResult {
  bool confirmed;      // 이번 프레임 후 과반 확정 상태인가
  Posture posture;     // 확정 자세 (confirmed=false 면 POSTURE_UNKNOWN)
  float confidence;    // 확정 자세 프레임들의 평균 confidence
  bool send;           // 지금 POST 해야 하는가
};

inline void posture_vote_reset(PostureVoter *v) {
  v->count = 0;
  v->head = 0;
  v->lastConfirmed = POSTURE_UNKNOWN;
}

inline void posture_vote_init(PostureVoter *v, int windowSize, float minConfidence) {
  if (windowSize < 1) windowSize = 1;
  if (windowSize > POSTURE_VOTE_MAX_FRAMES) windowSize = POSTURE_VOTE_MAX_FRAMES;
  v->windowSize = windowSize;
  v->minConfidence = minConfidence;
  posture_vote_reset(v);
}

inline VoteResult posture_vote_push(PostureVoter *v, Posture p, float confidence) {
  VoteResult r = {false, POSTURE_UNKNOWN, 0.0f, false};
  bool valid = p >= 0 && p < POSTURE_CLASS_COUNT && confidence >= v->minConfidence;
  if (valid) {
    v->frames[v->head] = p;
    v->confidences[v->head] = confidence;
    v->head = (v->head + 1) % v->windowSize;
    if (v->count < v->windowSize) v->count++;
  }
  if (v->count < v->windowSize) return r;

  int votes[POSTURE_CLASS_COUNT] = {0, 0, 0, 0};
  float sums[POSTURE_CLASS_COUNT] = {0, 0, 0, 0};
  for (int i = 0; i < v->count; i++) {
    votes[v->frames[i]]++;
    sums[v->frames[i]] += v->confidences[i];
  }
  int best = 0;
  for (int c = 1; c < POSTURE_CLASS_COUNT; c++) {
    if (votes[c] > votes[best]) best = c;
  }
  if (votes[best] * 2 <= v->windowSize) return r;  // 과반 아님

  r.confirmed = true;
  r.posture = static_cast<Posture>(best);
  r.confidence = sums[best] / votes[best];
  if (r.posture != v->lastConfirmed) {
    v->lastConfirmed = r.posture;
    r.send = r.posture != POSTURE_NO_PERSON;
  }
  return r;
}
