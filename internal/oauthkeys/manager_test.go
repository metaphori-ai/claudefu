package oauthkeys

import (
	"testing"
	"time"
)

// fixed "now": Monday 2026-08-24 10:00 AM America/Los_Angeles
func testNow(t *testing.T) time.Time {
	t.Helper()
	loc, err := time.LoadLocation("America/Los_Angeles")
	if err != nil {
		t.Fatalf("load location: %v", err)
	}
	return time.Date(2026, 8, 24, 10, 0, 0, 0, loc)
}

func TestParseResetClock(t *testing.T) {
	now := testNow(t)

	cases := []struct {
		name   string
		result string
		want   string // in America/Los_Angeles, "2006-01-02 15:04"
	}{
		{
			name:   "session limit same day (screenshot format)",
			result: "You've hit your session limit · resets 3:20pm (America/Los_Angeles)",
			want:   "2026-08-24 15:20",
		},
		{
			name:   "time already passed rolls to tomorrow",
			result: "You've hit your session limit · resets 9:00am (America/Los_Angeles)",
			want:   "2026-08-25 09:00",
		},
		{
			name:   "weekday form",
			result: "You've hit your weekly limit · resets Tue 2:00am (America/Los_Angeles)",
			want:   "2026-08-25 02:00",
		},
		{
			name:   "weekday same-day but passed rolls a week",
			result: "resets Mon 9:00am (America/Los_Angeles)",
			want:   "2026-08-31 09:00",
		},
		{
			name:   "no timezone falls back to now's location",
			result: "resets 11:30pm",
			want:   "2026-08-24 23:30",
		},
		{
			name:   "12am and 12pm handled",
			result: "resets 12:15am (America/Los_Angeles)",
			want:   "2026-08-25 00:15",
		},
	}

	loc := now.Location()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseResetClock(tc.result, now)
			if got == nil {
				t.Fatalf("parseResetClock(%q) = nil", tc.result)
			}
			if s := got.In(loc).Format("2006-01-02 15:04"); s != tc.want {
				t.Errorf("got %s, want %s", s, tc.want)
			}
		})
	}

	if got := parseResetClock("no clock here", now); got != nil {
		t.Errorf("expected nil for unparseable message, got %v", got)
	}
}

func TestParseLimitInfo(t *testing.T) {
	cases := []struct {
		result   string
		status   int
		wantType string
		wantHit  bool
	}{
		{"You've hit your session limit · resets 3:20pm (America/Los_Angeles)", 429, LimitSession, true},
		{"You've hit your weekly limit · resets Tue 2:00am (America/Los_Angeles)", 429, LimitWeekly, true},
		{"You've reached your Fable limit · resets 6:00pm (America/Los_Angeles)", 429, LimitModel, true},
		{"Claude AI usage limit reached", 0, LimitSession, true},
		{"1M context is not enabled for this account", 400, "", false},
		{"invalid model name", 404, "", false},
	}
	for _, tc := range cases {
		limitType, _, isLimit := ParseLimitInfo(tc.status, tc.result)
		if isLimit != tc.wantHit {
			t.Errorf("ParseLimitInfo(%d, %q) isLimit = %v, want %v", tc.status, tc.result, isLimit, tc.wantHit)
			continue
		}
		if isLimit && limitType != tc.wantType {
			t.Errorf("ParseLimitInfo(%d, %q) type = %q, want %q", tc.status, tc.result, limitType, tc.wantType)
		}
	}
}

func TestParseWeeklyFromLabel(t *testing.T) {
	cases := []struct {
		label   string
		wantDay int
		wantHM  string
		wantOK  bool
	}{
		{"3_TA--Tu-2AM", 2, "02:00", true},
		{"ALAN_1--SU-12PM", 0, "12:00", true},
		{"ALAN_3--M-3AM", 1, "03:00", true},
		{"ALAN_4--SA-4AM", 6, "04:00", true},
		{"4_MAI--Th-12AM", 4, "00:00", true},
		{"5_FCTX--F-2AM", 5, "02:00", true},
		{"6_CM--Su-4PM", 0, "16:00", true},
		{"CLAUDE_CODE_OAUTH_TOKEN", 0, "", false},
		{"random-name", 0, "", false},
	}
	for _, tc := range cases {
		day, hm, ok := ParseWeeklyFromLabel(tc.label)
		if ok != tc.wantOK {
			t.Errorf("ParseWeeklyFromLabel(%q) ok = %v, want %v", tc.label, ok, tc.wantOK)
			continue
		}
		if ok && (day != tc.wantDay || hm != tc.wantHM) {
			t.Errorf("ParseWeeklyFromLabel(%q) = (%d, %q), want (%d, %q)", tc.label, day, hm, tc.wantDay, tc.wantHM)
		}
	}
}

func TestNextWeeklyOccurrence(t *testing.T) {
	now := testNow(t) // Monday 10:00 AM

	// Tuesday 02:03 → tomorrow
	got := nextWeeklyOccurrence(2, "02:03", now)
	if s := got.Format("2006-01-02 15:04"); s != "2026-08-25 02:03" {
		t.Errorf("Tue 02:03 = %s, want 2026-08-25 02:03", s)
	}
	// Monday 09:00 (already passed today) → next Monday
	got = nextWeeklyOccurrence(1, "09:00", now)
	if s := got.Format("2006-01-02 15:04"); s != "2026-08-31 09:00" {
		t.Errorf("Mon 09:00 = %s, want 2026-08-31 09:00", s)
	}
	// Monday 12:03 (later today) → today
	got = nextWeeklyOccurrence(1, "12:03", now)
	if s := got.Format("2006-01-02 15:04"); s != "2026-08-24 12:03" {
		t.Errorf("Mon 12:03 = %s, want 2026-08-24 12:03", s)
	}
}

func TestAutoSelectionSort(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)

	// The manager sorts against real time.Now(), so build weekly resets
	// RELATIVE to now: keys resetting in +1, +3, and +5 days. The reset
	// time-of-day is one hour behind now so day arithmetic is unambiguous.
	now := time.Now()
	hm := now.Add(-1 * time.Hour).Format("15:04")
	dayIn := func(offset int) int { return (int(now.Weekday()) + offset) % 7 }

	if _, err := m.AddKey("plus5", "sk-ant-oat01-fff", dayIn(5), hm); err != nil {
		t.Fatal(err)
	}
	nearest, err := m.AddKey("plus1", "sk-ant-oat01-ttt", dayIn(1), hm)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := m.AddKey("plus3", "sk-ant-oat01-hhh", dayIn(3), hm); err != nil {
		t.Fatal(err)
	}

	// Nearest weekly reset wins (use-it-or-lose-it).
	keyID, token, mode := m.ResolveForSend("session-1", "")
	if mode != ModeAuto {
		t.Fatalf("mode = %s, want auto", mode)
	}
	if keyID != nearest.ID || token != "sk-ant-oat01-ttt" {
		t.Errorf("auto pick = %s, want plus1 key (nearest weekly reset)", keyID)
	}

	// Stickiness: same session keeps the same key.
	keyID2, _, _ := m.ResolveForSend("session-1", "")
	if keyID2 != keyID {
		t.Errorf("sticky violated: %s != %s", keyID2, keyID)
	}

	// Bench plus1 (session limit) → next pick is plus3.
	m.RecordLimit(nearest.ID, LimitSession, now.Add(1*time.Hour))
	nextID, _, ok := m.SelectNextAfterLimit("session-1")
	if !ok {
		t.Fatal("expected an available key")
	}
	if lbl := m.GetKey(nextID).Label; lbl != "plus3" {
		t.Errorf("next after limit = %s, want plus3", lbl)
	}

	// Weekly-bench plus3 and session-bench plus5 too → nothing available.
	m.RecordLimit(nextID, LimitWeekly, now.Add(48*time.Hour))
	for _, k := range m.GetKeys() {
		if k.Label == "plus5" {
			m.RecordLimit(k.ID, LimitSession, now.Add(2*time.Hour))
		}
	}
	if _, _, ok := m.SelectNextAfterLimit("session-1"); ok {
		t.Error("expected no available keys")
	}

	// ResolveForSend auto fallback still returns the soonest-available key
	// (plus1 frees up in 1h vs 2h and 48h).
	fbID, _, fbMode := m.ResolveForSend("session-2", "")
	if fbMode != ModeAuto || fbID == "" {
		t.Errorf("fallback resolve = (%s, %s), want soonest-available auto key", fbID, fbMode)
	}
	if lbl := m.GetKey(fbID).Label; lbl != "plus1" {
		t.Errorf("fallback = %s, want plus1 (soonest limitedUntil)", lbl)
	}
}

func TestPinnedMode(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	k, err := m.AddKey("pinme", "sk-ant-oat01-ppp", 1, "00:00")
	if err != nil {
		t.Fatal(err)
	}
	// Pinned works even when the key is limited — explicit choice wins.
	m.RecordLimit(k.ID, LimitSession, time.Now().Add(1*time.Hour))
	keyID, token, mode := m.ResolveForSend("s", k.ID)
	if mode != ModePinned || keyID != k.ID || token != "sk-ant-oat01-ppp" {
		t.Errorf("pinned resolve = (%s, %s, %s)", keyID, token, mode)
	}
	// Unknown ID falls back to legacy env behavior.
	if _, _, mode := m.ResolveForSend("s", "nonexistent"); mode != ModeNone {
		t.Errorf("unknown pinned id mode = %s, want none", mode)
	}
}

func TestPersistenceRoundTrip(t *testing.T) {
	dir := t.TempDir()
	m := NewManager(dir)
	k, err := m.AddKey("persist", "sk-ant-oat01-xyz", 3, "05:00")
	if err != nil {
		t.Fatal(err)
	}
	until := time.Now().Add(90 * time.Minute).Truncate(time.Second)
	m.RecordLimit(k.ID, LimitWeekly, until)

	m2 := NewManager(dir)
	keys := m2.GetKeys()
	if len(keys) != 1 || keys[0].Label != "persist" || keys[0].Token != "sk-ant-oat01-xyz" {
		t.Fatalf("config round trip failed: %+v", keys)
	}
	st := m2.GetState(k.ID)
	if st.WeeklyLimitedUntil == nil || !st.WeeklyLimitedUntil.Equal(until) {
		t.Errorf("state round trip failed: %+v", st)
	}
}
