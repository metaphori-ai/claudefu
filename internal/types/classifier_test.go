package types

import "testing"

// Shapes copied from real session files. Claude Code 2.1.280+ writes
// imagePasteIds as numbers; earlier CLIs wrote strings. Both must parse —
// a failed unmarshal here drops the user's prompt (and its image) from the
// conversation entirely.

const userImagePromptNumericIDs = `{"parentUuid":"d26bbbd7-e8f5-4b5e-8a45-d077908c364f","isSidechain":false,"userType":"external","cwd":"/tmp/x","sessionId":"461e1836-4962-4195-ab65-793fa38ccb86","version":"2.1.281","gitBranch":"main","slug":"zesty-cuddling-acorn","entrypoint":"sdk-cli","type":"user","message":{"role":"user","content":[{"type":"text","text":"Again you didn't follow my instructions"},{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"/9j/4AAQ"}}]},"uuid":"07283008-0000-4000-8000-000000000000","timestamp":"2026-09-25T18:48:53.754Z","permissionMode":"acceptEdits","promptId":"p1","promptSource":"sdk","turnOrigin":"sdk","imagePasteIds":[3,4]}`

const userImagePromptStringIDs = `{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"/tmp/x","sessionId":"s","version":"2.1.19","type":"user","message":{"role":"user","content":[{"type":"text","text":"look at this"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBOR"}}]},"uuid":"11111111-0000-4000-8000-000000000000","timestamp":"2026-01-01T00:00:00.000Z","imagePasteIds":["img-1"]}`

// The 2.1.274+ "turn companion": an isMeta user record echoing the pasted
// image's temp path. It must NOT surface as a user message.
const userImageCompanion = `{"parentUuid":"e02b7559-0000-4000-8000-000000000000","isSidechain":false,"userType":"external","cwd":"/tmp/x","sessionId":"s","version":"2.1.281","slug":"zesty-cuddling-acorn","entrypoint":"sdk-cli","type":"user","message":{"role":"user","content":[{"type":"text","text":"[Image: source: /private/tmp/claude-501/x/1.jpg]"}]},"isMeta":true,"turnCompanion":true,"uuid":"5cf7e591-0000-4000-8000-000000000000","timestamp":"2026-09-25T18:48:53.760Z","promptId":"p1"}`

func TestClassifyUserImagePrompt_NumericImagePasteIDs(t *testing.T) {
	classified, err := ClassifyJSONLEvent(userImagePromptNumericIDs)
	if err != nil {
		t.Fatalf("2.1.281 user record with numeric imagePasteIds failed to parse: %v", err)
	}
	msg := ConvertToMessage(classified)
	if msg == nil || msg.Type != "user" {
		t.Fatalf("expected a displayable user message, got %#v", msg)
	}
	if len(classified.User.ImagePasteIDs) != 2 {
		t.Fatalf("expected 2 imagePasteIds preserved raw, got %d", len(classified.User.ImagePasteIDs))
	}
	hasImage := false
	for _, b := range msg.ContentBlocks {
		if b.Type == "image" && b.Source != nil && b.Source.MediaType == "image/jpeg" {
			hasImage = true
		}
	}
	if !hasImage {
		t.Fatalf("image block lost in conversion: %#v", msg.ContentBlocks)
	}
}

func TestClassifyUserImagePrompt_LegacyStringImagePasteIDs(t *testing.T) {
	classified, err := ClassifyJSONLEvent(userImagePromptStringIDs)
	if err != nil {
		t.Fatalf("legacy user record with string imagePasteIds failed to parse: %v", err)
	}
	if msg := ConvertToMessage(classified); msg == nil || msg.Type != "user" {
		t.Fatalf("expected a displayable user message, got %#v", msg)
	}
}

func TestClassifyUserImageCompanion_IsHidden(t *testing.T) {
	classified, err := ClassifyJSONLEvent(userImageCompanion)
	if err != nil {
		t.Fatalf("companion record failed to parse: %v", err)
	}
	if classified.IsUserMessage() {
		t.Fatal("isMeta companion must not classify as a user message")
	}
	if msg := ConvertToMessage(classified); msg != nil {
		t.Fatalf("isMeta companion must convert to nil, got %#v", msg)
	}
}

func TestClassifyUnknownRecordTypes_AreSkippedNotErrored(t *testing.T) {
	for _, line := range []string{
		`{"type":"attachment","uuid":"a","parentUuid":"b","attachment":{"type":"total_tokens_reminder","text":"x"},"version":"2.1.281","timestamp":"2026-09-25T18:48:53.754Z"}`,
		`{"type":"last-prompt","lastPrompt":"hi","leafUuid":"b","sessionId":"s"}`,
		`{"type":"mode","mode":"normal","sessionId":"s"}`,
		`{"type":"cost-state","sessionId":"s","totalCostUSD":1.5}`,
		`{"type":"atis-latch","atis":"","sessionId":"s"}`,
	} {
		classified, err := ClassifyJSONLEvent(line)
		if err != nil {
			t.Fatalf("unknown record type should not error: %v (%s)", err, line)
		}
		if classified.EventType != JSONLEventUnknown {
			t.Fatalf("expected unknown, got %v for %s", classified.EventType, line)
		}
		if ConvertToMessage(classified) != nil {
			t.Fatalf("unknown record type must convert to nil: %s", line)
		}
	}
}
