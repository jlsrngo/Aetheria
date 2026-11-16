//! Anti-Doom-Loop and Repeated Invocations Breaker.
//!
//! Prevents models from getting trapped in endless identical tool call loops
//! (e.g. failing to edit a document and retrying with the exact same arguments 25 times),
//! preserving user tokens, API budget, and system responsiveness.

use serde_json::Value;
use std::collections::HashMap;

const FAILURE_ESCALATION_THRESHOLD: usize = 3;
const FAILURE_HARD_BLOCK_THRESHOLD: usize = 5;

fn extract_target_file_key(args_val: &Value) -> String {
    for key in ["filePath", "path", "file", "target"] {
        if let Some(raw) = args_val.get(key).and_then(Value::as_str) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return trimmed.replace('\\', "/").to_ascii_lowercase();
            }
        }
    }
    String::new()
}

fn extract_target_from_canonical(args_canonical: &str) -> String {
    serde_json::from_str::<Value>(args_canonical)
        .ok()
        .map(|val| extract_target_file_key(&val))
        .unwrap_or_default()
}

/// Tracks tool calls within an agent turn and detects doom loops.
#[derive(Debug, Clone)]
pub struct DoomLoopDetector {
    call_counts: HashMap<(String, String), usize>,
    consecutive_call: Option<(String, String)>,
    consecutive_count: usize,
    shell_read_count: usize,
    file_read_counts: HashMap<String, usize>,
    failure_streaks: HashMap<(String, String), usize>,
    threshold: usize,
}

impl Default for DoomLoopDetector {
    fn default() -> Self {
        Self::new(3)
    }
}

impl DoomLoopDetector {
    /// Creates a new detector with a given repetition threshold (default 3).
    pub fn new(threshold: usize) -> Self {
        Self {
            call_counts: HashMap::new(),
            consecutive_call: None,
            consecutive_count: 0,
            shell_read_count: 0,
            file_read_counts: HashMap::new(),
            failure_streaks: HashMap::new(),
            threshold: threshold.max(2),
        }
    }

    /// Checks if a tool call constitutes a doom loop.
    ///
    /// If repetition exceeds the threshold, returns `Some(warning_message)`.
    /// Otherwise returns `None` and records the invocation.
    pub fn check_and_record(&mut self, tool_name: &str, args_canonical: &str) -> Option<String> {
        let t_norm = tool_name.trim().to_lowercase();

        // 1. Guard against LLM shell file-inspection loops on Windows
        if t_norm == "bash" || t_norm == "shell" || t_norm == "terminal" {
            let lower_args = args_canonical.to_lowercase();
            if lower_args.contains("cat ")
                || lower_args.contains("head ")
                || lower_args.contains("more ")
                || lower_args.contains("type ")
                || lower_args.contains("get-content")
                || lower_args.contains("readfilesync")
            {
                self.shell_read_count += 1;
                if self.shell_read_count >= 6 {
                    return Some(
                        "Tool execution blocked: Shell file inspection loop detected. Do NOT use shell commands (cat, type, more, node, Get-Content) to inspect files. Use the 'read' tool directly, or if files are already written, proceed immediately to calling 'render_video' to export the MP4.".to_string(),
                    );
                }
            }
        }

        // 2. Guard against LLM repetitive file-read loops while allowing legitimate pagination
        if t_norm == "read" || t_norm == "read_file" {
            return None;
        }

        // 3. Hard-block when the same tool has failed repeatedly on the same target file
        //    even if arguments like `oldString` keep varying.
        let target_key = extract_target_from_canonical(args_canonical);
        if let Some(&streak) = self.failure_streaks.get(&(t_norm.clone(), target_key.clone())) {
            if streak >= FAILURE_HARD_BLOCK_THRESHOLD {
                let target_label = if target_key.is_empty() {
                    "(current target)"
                } else {
                    target_key.as_str()
                };
                return Some(format!(
                    "Tool execution blocked: '{}' failed {} consecutive times on '{}'. Stop guessing edits. Read unread line ranges with 'read' (offset/limit), use 'grep' to locate symbols, pass 'startLine'/'endLine', or rewrite cleanly with 'write'.",
                    tool_name, streak, target_label
                ));
            }
        }

        let key = (
            t_norm.clone(),
            args_canonical.trim().to_string(),
        );

        // 1. Total count of this exact invocation in the entire turn
        let total = self.call_counts.entry(key.clone()).or_insert(0);
        *total += 1;

        // 2. Consecutive identical invocations
        if let Some(ref prev) = self.consecutive_call {
            if prev == &key {
                self.consecutive_count += 1;
            } else {
                self.consecutive_call = Some(key.clone());
                self.consecutive_count = 1;
            }
        } else {
            self.consecutive_call = Some(key.clone());
            self.consecutive_count = 1;
        }

        if self.consecutive_count >= self.threshold || *total >= (self.threshold + 1) {
            let count = self.consecutive_count.max(*total);
            Some(format!(
                "Tool execution blocked: Repeated identical invocation of tool '{}' detected ({} times). You appear stuck in an execution loop. Do not call this tool with the same arguments again. Analyze the failure, try a different strategy, verify file names, or ask the user for clarification.",
                tool_name, count
            ))
        } else {
            None
        }
    }

    /// Records whether an executed tool call succeeded or failed.
    ///
    /// Verification counters (`capture_film_preview`, `render_video`) are reset ONLY after a
    /// workspace mutation actually succeeds, preventing failed edits from disguising preview loops.
    /// Returns an escalation message once consecutive failures for `(tool, target)` reach 3+.
    pub fn record_outcome(
        &mut self,
        tool_name: &str,
        args_val: &Value,
        is_failed: bool,
    ) -> Option<String> {
        let t_norm = tool_name.trim().to_lowercase();
        let target_key = extract_target_file_key(args_val);
        let key = (t_norm.clone(), target_key.clone());

        if !is_failed {
            self.failure_streaks.remove(&key);
            if matches!(t_norm.as_str(), "write" | "apply_patch" | "film_scaffold")
                && !target_key.is_empty()
            {
                self.failure_streaks
                    .remove(&("edit".to_string(), target_key.clone()));
            }
            if matches!(
                t_norm.as_str(),
                "write" | "edit" | "apply_patch" | "codemode" | "film_scaffold"
            ) {
                self.call_counts.retain(|(tool, _), _| {
                    !matches!(tool.as_str(), "capture_film_preview" | "render_video")
                });
                if let Some((prev_tool, _)) = &self.consecutive_call {
                    if matches!(prev_tool.as_str(), "capture_film_preview" | "render_video") {
                        self.consecutive_call = None;
                        self.consecutive_count = 0;
                    }
                }
            }
            return None;
        }

        let streak = self.failure_streaks.entry(key).or_insert(0);
        *streak += 1;
        if *streak >= FAILURE_ESCALATION_THRESHOLD {
            let target_label = if target_key.is_empty() {
                "(current target)"
            } else {
                target_key.as_str()
            };
            return Some(format!(
                "HARNESS FAILURE-STREAK ESCALATION ({} consecutive '{}' failures on '{}'): stop retrying guessed text blobs. Use 'grep' to locate symbols, 'read' with offset/limit on unread regions, pass explicit 'startLine'/'endLine', or call 'write' to replace cleanly.",
                *streak, tool_name, target_label
            ));
        }
        None
    }

    /// Resets detector counters between turns.
    pub fn reset(&mut self) {
        self.call_counts.clear();
        self.consecutive_call = None;
        self.consecutive_count = 0;
        self.shell_read_count = 0;
        self.file_read_counts.clear();
        self.failure_streaks.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_allows_normal_calls_and_varying_args() {
        let mut detector = DoomLoopDetector::new(3);

        assert!(detector.check_and_record("read_file", r#"{"path":"a.txt"}"#).is_none());
        assert!(detector.check_and_record("read_file", r#"{"path":"b.txt"}"#).is_none());
        assert!(detector.check_and_record("read_file", r#"{"path":"c.txt"}"#).is_none());
    }

    #[test]
    fn test_blocks_consecutive_identical_calls_at_threshold() {
        let mut detector = DoomLoopDetector::new(3);

        assert!(detector.check_and_record("edit", r#"{"path":"doc.docx"}"#).is_none());
        assert!(detector.check_and_record("edit", r#"{"path":"doc.docx"}"#).is_none());

        // 3rd consecutive call triggers the breaker
        let blocked = detector.check_and_record("edit", r#"{"path":"doc.docx"}"#);
        assert!(blocked.is_some());
        let msg = blocked.unwrap();
        assert!(msg.contains("Repeated identical invocation"));
        assert!(msg.contains("edit"));
    }

    #[test]
    fn test_blocks_alternating_repeated_calls() {
        let mut detector = DoomLoopDetector::new(3);

        // A, B, A, B, A, B (threshold+1 = 4 total)
        assert!(detector.check_and_record("tool_a", "{}").is_none());
        assert!(detector.check_and_record("tool_b", "{}").is_none());
        assert!(detector.check_and_record("tool_a", "{}").is_none());
        assert!(detector.check_and_record("tool_b", "{}").is_none());
        assert!(detector.check_and_record("tool_a", "{}").is_none());
        assert!(detector.check_and_record("tool_b", "{}").is_none());

        // 4th total invocation of tool_a triggers total count breaker
        let blocked = detector.check_and_record("tool_a", "{}");
        assert!(blocked.is_some());
    }

    #[test]
    fn test_allows_capture_film_preview_after_workspace_mutations() {
        let mut detector = DoomLoopDetector::new(3);
        let preview_args = r#"{"timestamps":[1,5,10,18]}"#;

        for idx in 1..=5 {
            let write_args_str =
                format!(r#"{{"filePath":"script/scene{}.js","content":"// v{}"}}"#, idx, idx);
            let write_val: Value = serde_json::from_str(&write_args_str).unwrap();
            assert!(detector.check_and_record("write", &write_args_str).is_none());
            assert!(detector.record_outcome("write", &write_val, false).is_none());
            assert!(
                detector.check_and_record("capture_film_preview", preview_args).is_none(),
                "capture_film_preview after a successful file write must not be blocked by prior preview counts"
            );
        }
    }

    #[test]
    fn test_failed_edit_does_not_reset_capture_film_preview_loop() {
        let mut detector = DoomLoopDetector::new(3);
        let preview_args = r#"{"timestamps":[0,1.5,4.5,7]}"#;

        // With alternating failed edits, total preview calls are NOT reset,
        // so the (threshold + 1) = 4th identical capture_film_preview is blocked.
        for i in 1..=3 {
            let edit_str = format!(r#"{{"filePath":"script/scene1.js","oldString":"bad_{}"}}"#, i);
            let edit_val: Value = serde_json::from_str(&edit_str).unwrap();
            assert!(detector.check_and_record("edit", &edit_str).is_none());
            detector.record_outcome("edit", &edit_val, true);
            assert!(detector.check_and_record("capture_film_preview", preview_args).is_none());
        }

        let edit4_str = r#"{"filePath":"script/scene1.js","oldString":"bad_4"}"#;
        let edit4_val: Value = serde_json::from_str(edit4_str).unwrap();
        assert!(detector.check_and_record("edit", edit4_str).is_none());
        detector.record_outcome("edit", &edit4_val, true);

        let blocked = detector.check_and_record("capture_film_preview", preview_args);
        assert!(blocked.is_some());
        assert!(blocked.unwrap().contains("capture_film_preview"));
    }

    #[test]
    fn test_failure_streak_escalates_at_3_and_blocks_at_5_and_write_resets_it() {
        let mut detector = DoomLoopDetector::new(3);
        for i in 1..=5 {
            let args_str = format!(r#"{{"filePath":"script/scene1.js","oldString":"guess_{}"}}"#, i);
            let args_val: Value = serde_json::from_str(&args_str).unwrap();
            assert!(detector.check_and_record("edit", &args_str).is_none());
            let esc = detector.record_outcome("edit", &args_val, true);
            if i < 3 {
                assert!(esc.is_none());
            } else {
                let msg = esc.expect("should escalate from 3rd failure");
                assert!(msg.contains("HARNESS FAILURE-STREAK ESCALATION"));
                assert!(msg.contains("script/scene1.js"));
            }
        }

        let args6 = r#"{"filePath":"script/scene1.js","oldString":"guess_6"}"#;
        let hard_blocked = detector.check_and_record("edit", args6);
        assert!(hard_blocked.is_some());
        assert!(hard_blocked.unwrap().contains("Stop guessing edits"));

        // Successful write on the same file clears edit failure streak
        let write_val: Value =
            serde_json::from_str(r#"{"filePath":"script/scene1.js","content":"ok"}"#).unwrap();
        assert!(detector.record_outcome("write", &write_val, false).is_none());
        assert!(detector.check_and_record("edit", args6).is_none());
    }
}

