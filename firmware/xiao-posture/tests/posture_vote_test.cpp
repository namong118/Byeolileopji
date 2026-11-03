// posture_vote.h 단위 테스트 (하드웨어 없이 g++ 로 실행).
//   g++ -std=c++17 -Wall -Wextra -Werror -I firmware/xiao-posture firmware/xiao-posture/tests/posture_vote_test.cpp -o posture_vote_test
//   ./posture_vote_test
#include <cmath>
#include <cstdio>
#include <cstring>

#include "posture_vote.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    checks++;                                                           \
    if (!(cond)) {                                                      \
      failures++;                                                       \
      std::printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond);     \
    }                                                                   \
  } while (0)

static PostureVoter make() {
  PostureVoter v;
  posture_vote_init(&v, 5, 0.6f);
  return v;
}

static VoteResult pushN(PostureVoter *v, Posture p, int n, float c = 0.9f) {
  VoteResult r = {false, POSTURE_UNKNOWN, 0, false};
  for (int i = 0; i < n; i++) r = posture_vote_push(v, p, c);
  return r;
}

static void test_needs_full_window() {
  PostureVoter v = make();
  VoteResult r = pushN(&v, POSTURE_SITTING, 4);
  CHECK(!r.confirmed);
  CHECK(!r.send);
  r = posture_vote_push(&v, POSTURE_SITTING, 0.9f);
  CHECK(r.confirmed);
  CHECK(r.send);
  CHECK(r.posture == POSTURE_SITTING);
  CHECK(std::strcmp(posture_api_name(r.posture), "sitting") == 0);
}

static void test_send_only_on_change() {
  PostureVoter v = make();
  CHECK(pushN(&v, POSTURE_STANDING, 5).send);
  CHECK(!pushN(&v, POSTURE_STANDING, 10).send);  // 같은 자세 유지 → 재전송 없음
  // 2프레임 lying 은 과반이 아님 → 여전히 standing, 전송 없음
  CHECK(!pushN(&v, POSTURE_LYING, 2).send);
  VoteResult r = posture_vote_push(&v, POSTURE_LYING, 0.9f);  // 3/5 lying
  CHECK(r.send);
  CHECK(r.posture == POSTURE_LYING);
}

static void test_majority_required() {
  PostureVoter v = make();
  posture_vote_push(&v, POSTURE_STANDING, 0.9f);
  posture_vote_push(&v, POSTURE_STANDING, 0.9f);
  posture_vote_push(&v, POSTURE_SITTING, 0.9f);
  posture_vote_push(&v, POSTURE_SITTING, 0.9f);
  VoteResult r = posture_vote_push(&v, POSTURE_LYING, 0.9f);  // 2/2/1 → 과반 없음
  CHECK(!r.confirmed);
  CHECK(!r.send);
}

static void test_low_confidence_ignored() {
  PostureVoter v = make();
  pushN(&v, POSTURE_SITTING, 4);
  VoteResult r = pushN(&v, POSTURE_LYING, 10, 0.59f);  // 모두 기준 미만 → 버림
  CHECK(!r.confirmed);
  CHECK(v.count == 4);
  r = posture_vote_push(&v, POSTURE_SITTING, 0.6f);  // 경계값 0.6 은 포함
  CHECK(r.confirmed && r.send && r.posture == POSTURE_SITTING);
}

static void test_no_person_not_sent() {
  PostureVoter v = make();
  CHECK(pushN(&v, POSTURE_SITTING, 5).send);
  VoteResult r = pushN(&v, POSTURE_NO_PERSON, 5);
  CHECK(r.confirmed);
  CHECK(r.posture == POSTURE_NO_PERSON);
  CHECK(!r.send);
  CHECK(posture_api_name(POSTURE_NO_PERSON) == nullptr);
  // 사람이 다시 보이면, 직전과 같은 자세라도 전송한다 (no_person 이 사이에 확정됐으므로)
  r = pushN(&v, POSTURE_SITTING, 3);  // 3/5 과반이 되는 프레임에서 전송
  CHECK(r.send && r.posture == POSTURE_SITTING);
}

static void test_room_switch_sends_first_posture() {
  PostureVoter v = make();
  CHECK(pushN(&v, POSTURE_LYING, 5).send);
  posture_vote_reset(&v);  // BOOT 버튼: 다음 방
  CHECK(v.count == 0);
  CHECK(!pushN(&v, POSTURE_LYING, 4).send);  // 버퍼 초기화 → 다시 5프레임 필요
  VoteResult r = posture_vote_push(&v, POSTURE_LYING, 0.9f);
  CHECK(r.send);  // 직전 방과 같은 자세라도 새 방의 첫 확정은 바로 전송
  CHECK(!pushN(&v, POSTURE_LYING, 3).send);
}

static void test_average_confidence() {
  PostureVoter v = make();
  posture_vote_push(&v, POSTURE_STANDING, 0.7f);
  posture_vote_push(&v, POSTURE_STANDING, 0.8f);
  posture_vote_push(&v, POSTURE_STANDING, 0.9f);
  posture_vote_push(&v, POSTURE_SITTING, 0.9f);
  VoteResult r = posture_vote_push(&v, POSTURE_SITTING, 0.9f);
  CHECK(r.posture == POSTURE_STANDING);
  CHECK(std::fabs(r.confidence - 0.8f) < 1e-5f);
}

static void test_invalid_class_ignored() {
  PostureVoter v = make();
  VoteResult r = pushN(&v, POSTURE_UNKNOWN, 10);
  CHECK(!r.confirmed);
  CHECK(v.count == 0);
}

int main() {
  test_needs_full_window();
  test_send_only_on_change();
  test_majority_required();
  test_low_confidence_ignored();
  test_no_person_not_sent();
  test_room_switch_sends_first_posture();
  test_average_confidence();
  test_invalid_class_ignored();
  if (failures) {
    std::printf("posture_vote: %d/%d checks FAILED\n", failures, checks);
    return 1;
  }
  std::printf("posture_vote: %d checks passed\n", checks);
  return 0;
}
