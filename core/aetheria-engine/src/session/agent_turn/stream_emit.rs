//! Incremental OpenCode-compatible Stream Fragment Emitter (`W1` Streaming).
//! Batches text and reasoning deltas at 100ms intervals while flushing pending
//! deltas immediately on block switches, assembling streaming tool call arguments,
//! and cleanly closing open parts on finish or user abort.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::time::Instant;

use crate::paths::{gen_id, now_ms};
use crate::session::message::emit_event;

/// OpenCode delta batching interval (`publish-llm-event.ts`).
pub const DELTA_BATCH_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone)]
pub(crate) struct StreamToolCall {
    pub call_id: String,
    pub name: String,
    pub args: String,
    pub extra_content: Option<Value>,
    pub started_emitted: bool,
}

#[derive(Debug, Clone)]
struct FragmentBlock {
    part_id: String,
    started_at: u64,
    started_emitted: bool,
    full: String,
    pending: String,
}

impl FragmentBlock {
    fn new(prefix: &str) -> Self {
        Self {
            part_id: gen_id(prefix),
            started_at: now_ms(),
            started_emitted: false,
            full: String::new(),
            pending: String::new(),
        }
    }
}

pub(crate) struct StreamStepOutput {
    pub text: String,
    pub reasoning: String,
    pub tool_calls: Vec<Value>,
    pub content_parts: Vec<Value>,
    pub assistant_msg: Value,
    pub raw_finish: Option<String>,
    pub usage: Option<Value>,
}

pub(crate) struct StreamStepEmitter<F = fn(&str, &str, Value)>
where
    F: FnMut(&str, &str, Value),
{
    workspace_dir: String,
    session_id: String,
    assistant_msg_id: String,
    emit: F,
    text: Option<FragmentBlock>,
    reasoning: Option<FragmentBlock>,
    accumulated_reasoning: String,
    reasoning_field: Option<String>,
    reasoning_details: Option<Vec<Value>>,
    reasoning_opaque: Option<String>,
    tool_calls: BTreeMap<usize, StreamToolCall>,
    content_parts: Vec<Value>,
    flush_deadline: Option<Instant>,
    pub raw_finish: Option<String>,
    pub usage: Option<Value>,
}

fn append_text_field(target: &mut Value, incoming: &Value, field: &str) {
    if let Some(delta) = incoming.get(field).and_then(Value::as_str) {
        if !delta.is_empty() {
            let prev = target.get(field).and_then(Value::as_str).unwrap_or("");
            target[field] = Value::String(format!("{}{}", prev, delta));
        }
    }
}

fn details_match_slot(a: &Value, b: &Value) -> bool {
    let a_id = a.get("id").and_then(Value::as_str).unwrap_or("");
    let b_id = b.get("id").and_then(Value::as_str).unwrap_or("");
    if !a_id.is_empty() || !b_id.is_empty() {
        return a_id == b_id;
    }
    let a_ty = a.get("type").and_then(Value::as_str).unwrap_or("");
    let b_ty = b.get("type").and_then(Value::as_str).unwrap_or("");
    if !matches!(a_ty, "reasoning.text" | "reasoning.summary" | "summary") || a_ty != b_ty {
        return false;
    }
    a.get("format") == b.get("format")
        && a.get("index") == b.get("index")
        && (a.get("signature").is_none()
            || b.get("signature").is_none()
            || a.get("signature") == b.get("signature"))
}

fn merge_reasoning_details_chunk(acc: &mut Vec<Value>, incoming: &Value) {
    let items: Vec<&Value> = match incoming {
        Value::Array(arr) => arr.iter().collect(),
        Value::Object(_) => vec![incoming],
        _ => return,
    };
    for item in items {
        if !item.is_object() {
            continue;
        }
        if let Some(last) = acc.last_mut().filter(|prev| details_match_slot(prev, item)) {
            append_text_field(last, item, "text");
            append_text_field(last, item, "summary");
            if let Some(sig) = item.get("signature").filter(|v| !v.is_null()) {
                last["signature"] = sig.clone();
            }
            if let Some(data) = item.get("data").filter(|v| !v.is_null()) {
                last["data"] = data.clone();
            }
        } else {
            acc.push(item.clone());
        }
    }
}

impl StreamStepEmitter<fn(&str, &str, Value)> {
    pub fn new(workspace_dir: &str, session_id: &str, assistant_msg_id: &str) -> Self {
        Self::with_emitter(workspace_dir, session_id, assistant_msg_id, emit_event)
    }
}

impl<F> StreamStepEmitter<F>
where
    F: FnMut(&str, &str, Value),
{
    pub fn with_emitter(
        workspace_dir: &str,
        session_id: &str,
        assistant_msg_id: &str,
        emit: F,
    ) -> Self {
        Self {
            workspace_dir: workspace_dir.to_string(),
            session_id: session_id.to_string(),
            assistant_msg_id: assistant_msg_id.to_string(),
            emit,
            text: None,
            reasoning: None,
            accumulated_reasoning: String::new(),
            reasoning_field: None,
            reasoning_details: None,
            reasoning_opaque: None,
            tool_calls: BTreeMap::new(),
            content_parts: Vec::new(),
            flush_deadline: None,
            raw_finish: None,
            usage: None,
        }
    }

    pub fn flush_deadline(&self) -> Option<Instant> {
        self.flush_deadline
    }

    fn arm_deadline(&mut self) {
        if self.flush_deadline.is_none() {
            self.flush_deadline = Some(Instant::now() + DELTA_BATCH_INTERVAL);
        }
    }

    fn clear_deadline_if_idle(&mut self) {
        let text_pending = self
            .text
            .as_ref()
            .map(|b| !b.pending.is_empty())
            .unwrap_or(false);
        let reason_pending = self
            .reasoning
            .as_ref()
            .map(|b| !b.pending.is_empty())
            .unwrap_or(false);
        if !text_pending && !reason_pending {
            self.flush_deadline = None;
        }
    }

    fn flush_text_pending(&mut self) {
        let Some(ref mut blk) = self.text else {
            return;
        };
        if !blk.started_emitted {
            blk.started_emitted = true;
            (self.emit)(
                &self.workspace_dir,
                "session.next.text.started",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                }),
            );
        }
        if !blk.pending.is_empty() {
            let delta = std::mem::take(&mut blk.pending);
            (self.emit)(
                &self.workspace_dir,
                "session.next.text.delta",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                    "delta": delta,
                }),
            );
        }
        self.clear_deadline_if_idle();
    }

    fn flush_reasoning_pending(&mut self) {
        let Some(ref mut blk) = self.reasoning else {
            return;
        };
        if !blk.started_emitted {
            blk.started_emitted = true;
            (self.emit)(
                &self.workspace_dir,
                "session.next.reasoning.started",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                }),
            );
        }
        if !blk.pending.is_empty() {
            let delta = std::mem::take(&mut blk.pending);
            (self.emit)(
                &self.workspace_dir,
                "session.next.reasoning.delta",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                    "delta": delta,
                }),
            );
        }
        self.clear_deadline_if_idle();
    }

    fn close_reasoning(&mut self) -> String {
        if self.reasoning.is_none() {
            return String::new();
        }
        self.flush_reasoning_pending();
        let Some(blk) = self.reasoning.take() else {
            return String::new();
        };
        let end_ms = now_ms();
        (self.emit)(
            &self.workspace_dir,
            "session.next.reasoning.ended",
            json!({
                "sessionID": self.session_id,
                "messageID": self.assistant_msg_id,
                "id": blk.part_id,
                "text": blk.full,
            }),
        );
        if !blk.full.is_empty() {
            self.content_parts.push(json!({
                "type": "reasoning",
                "id": blk.part_id,
                "text": blk.full,
                "reasoningField": self.reasoning_field.as_deref().unwrap_or("reasoning_content"),
                "time": { "start": blk.started_at, "end": end_ms, "created": blk.started_at, "completed": end_ms }
            }));
        }
        blk.full
    }

    fn close_text(&mut self) -> String {
        if self.text.is_none() {
            return String::new();
        }
        self.flush_text_pending();
        let Some(blk) = self.text.take() else {
            return String::new();
        };
        (self.emit)(
            &self.workspace_dir,
            "session.next.text.ended",
            json!({
                "sessionID": self.session_id,
                "messageID": self.assistant_msg_id,
                "id": blk.part_id,
                "text": blk.full,
            }),
        );
        if !blk.full.is_empty() {
            self.content_parts.push(json!({
                "type": "text",
                "id": blk.part_id,
                "text": blk.full,
            }));
        }
        blk.full
    }

    /// Appends a streamed reasoning fragment, holding open text (flushing its
    /// pending delta first) so text blocks remain unified across reasoning bursts.
    pub fn on_reasoning_delta(&mut self, frag: &str) {
        self.on_reasoning_delta_with_field("reasoning_content", frag);
    }

    pub fn on_reasoning_delta_with_field(&mut self, field: &str, frag: &str) {
        if frag.is_empty() {
            return;
        }
        if self.reasoning_field.is_none() && !field.trim().is_empty() {
            self.reasoning_field = Some(field.to_string());
        }
        self.flush_text_pending();
        if self.reasoning.is_none() {
            let mut blk = FragmentBlock::new("rsn");
            blk.started_emitted = true;
            (self.emit)(
                &self.workspace_dir,
                "session.next.reasoning.started",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                }),
            );
            self.reasoning = Some(blk);
        }
        if let Some(ref mut blk) = self.reasoning {
            blk.full.push_str(frag);
            blk.pending.push_str(frag);
        }
        self.accumulated_reasoning.push_str(frag);
        self.arm_deadline();
    }

    /// Appends a streamed assistant text fragment. When switching into a brand-new
    /// text block from reasoning, flushes reasoning deltas, emits `text.started`,
    /// and then closes the reasoning block (matching OpenCode event ordering).
    pub fn on_text_delta(&mut self, frag: &str) {
        if frag.is_empty() {
            return;
        }
        if self.text.is_none() {
            self.flush_reasoning_pending();
            let mut blk = FragmentBlock::new("txt");
            blk.started_emitted = true;
            (self.emit)(
                &self.workspace_dir,
                "session.next.text.started",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": blk.part_id,
                }),
            );
            self.text = Some(blk);
            if self.reasoning.is_some() {
                self.close_reasoning();
            }
        } else if self.reasoning.is_some() {
            self.close_reasoning();
        }
        if let Some(ref mut blk) = self.text {
            blk.full.push_str(frag);
            blk.pending.push_str(frag);
        }
        self.arm_deadline();
    }

    /// Resolves the logical slot index for an incoming streamed tool-call delta, handling
    /// gateways that omit `index` or emit sparse indices keyed only by `id`.
    pub fn resolve_tool_call_index(
        &self,
        explicit_index: Option<usize>,
        id: Option<&str>,
        arr_pos: usize,
    ) -> usize {
        if let Some(idx) = explicit_index {
            return idx;
        }
        let clean_id = id.map(str::trim).filter(|s| !s.is_empty());
        if let Some(cid) = clean_id {
            if let Some((&existing_idx, _)) =
                self.tool_calls.iter().find(|(_, tc)| tc.call_id == cid)
            {
                return existing_idx;
            }
            if !self.tool_calls.contains_key(&arr_pos) {
                return arr_pos;
            }
            return self
                .tool_calls
                .keys()
                .next_back()
                .map(|m| m + 1)
                .unwrap_or(arr_pos)
                .max(arr_pos);
        }
        if arr_pos == 0 && !self.tool_calls.is_empty() {
            return *self.tool_calls.keys().next_back().unwrap_or(&0);
        }
        arr_pos
    }

    /// Accumulates a streamed tool call chunk, flushing any buffered deltas first
    /// and emitting `session.next.tool.input.started` as soon as the tool name arrives.
    pub fn on_tool_call_delta(
        &mut self,
        index: usize,
        id: Option<&str>,
        name: Option<&str>,
        args_frag: Option<&str>,
    ) {
        self.flush_text_pending();
        if self.reasoning.is_some() {
            self.close_reasoning();
        }
        let entry = self.tool_calls.entry(index).or_insert_with(|| StreamToolCall {
            call_id: gen_id("call"),
            name: String::new(),
            args: String::new(),
            extra_content: None,
            started_emitted: false,
        });
        if let Some(cid) = id.filter(|s| !s.is_empty()) {
            entry.call_id = cid.to_string();
        }
        if let Some(n) = name.filter(|s| !s.is_empty()) {
            if entry.name.is_empty() {
                entry.name = n.to_string();
            }
        }
        if !entry.started_emitted && !entry.name.is_empty() {
            entry.started_emitted = true;
            (self.emit)(
                &self.workspace_dir,
                "session.next.tool.input.started",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": entry.call_id,
                    "name": entry.name,
                    "tool": entry.name,
                }),
            );
        }
        if let Some(frag) = args_frag {
            entry.args.push_str(frag);
        }
    }

    pub fn on_tool_call_extra_content(&mut self, index: usize, extra: &Value) {
        if extra.is_null() {
            return;
        }
        let entry = self.tool_calls.entry(index).or_insert_with(|| StreamToolCall {
            call_id: gen_id("call"),
            name: String::new(),
            args: String::new(),
            extra_content: None,
            started_emitted: false,
        });
        entry.extra_content = Some(extra.clone());
    }

    pub fn on_reasoning_details(&mut self, details: &Value) {
        if !details.is_null() {
            let acc = self.reasoning_details.get_or_insert_with(Vec::new);
            merge_reasoning_details_chunk(acc, details);
        }
    }

    pub fn on_reasoning_opaque(&mut self, opaque: &str) {
        if !opaque.is_empty() {
            self.reasoning_opaque = Some(opaque.to_string());
        }
    }

    /// Flushes any accumulated deltas when the 100ms batch window fires.
    pub fn flush_timer_tick(&mut self) {
        self.flush_reasoning_pending();
        self.flush_text_pending();
        self.flush_deadline = None;
    }

    /// Finalizes all open blocks and tool inputs cleanly on normal stream completion.
    pub fn finish_all(mut self) -> StreamStepOutput {
        let _ = self.close_reasoning();
        let reasoning = std::mem::take(&mut self.accumulated_reasoning);
        let text = self.close_text();

        let mut tc_values = Vec::with_capacity(self.tool_calls.len());
        for (_, tc) in &mut self.tool_calls {
            let final_name = if tc.name.is_empty() {
                "tool".to_string()
            } else {
                tc.name.clone()
            };
            let input = serde_json::from_str::<Value>(&tc.args).unwrap_or_else(|_| json!({}));
            if !tc.started_emitted {
                tc.started_emitted = true;
                (self.emit)(
                    &self.workspace_dir,
                    "session.next.tool.input.started",
                    json!({
                        "sessionID": self.session_id,
                        "messageID": self.assistant_msg_id,
                        "id": tc.call_id,
                        "name": final_name,
                        "tool": final_name,
                    }),
                );
            }
            (self.emit)(
                &self.workspace_dir,
                "session.next.tool.input.ended",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": tc.call_id,
                    "name": final_name,
                    "text": tc.args,
                }),
            );
            (self.emit)(
                &self.workspace_dir,
                "session.next.tool.called",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": tc.call_id,
                    "toolName": final_name,
                    "input": input,
                }),
            );
            let mut tc_obj = json!({
                "id": tc.call_id,
                "type": "function",
                "function": {
                    "name": final_name,
                    "arguments": tc.args,
                }
            });
            if let Some(ref extra) = tc.extra_content {
                tc_obj["extra_content"] = extra.clone();
            }
            tc_values.push(tc_obj);
        }

        let content_val = if text.is_empty() && !tc_values.is_empty() {
            Value::Null
        } else {
            Value::String(text.clone())
        };
        let mut assistant_msg = json!({
            "role": "assistant",
            "content": content_val,
        });
        if !reasoning.is_empty() {
            let field = self
                .reasoning_field
                .as_deref()
                .unwrap_or("reasoning_content");
            assistant_msg[field] = Value::String(reasoning.clone());
        }
        if let Some(rd) = self.reasoning_details.take() {
            if !rd.is_empty() {
                assistant_msg["reasoning_details"] = Value::Array(rd);
            }
        }
        if let Some(ro) = self.reasoning_opaque.take() {
            assistant_msg["reasoning_opaque"] = Value::String(ro);
        }
        if !tc_values.is_empty() {
            assistant_msg["tool_calls"] = Value::Array(tc_values.clone());
        }

        StreamStepOutput {
            text,
            reasoning,
            tool_calls: tc_values,
            content_parts: self.content_parts,
            assistant_msg,
            raw_finish: self.raw_finish,
            usage: self.usage,
        }
    }

    /// Discards any un-started buffered chunks on mid-stream disconnect before
    /// retry, or closes already-started blocks cleanly if aborted mid-turn (`K06`/`K07`).
    pub fn close_started_on_abort(mut self) -> Vec<Value> {
        if self
            .reasoning
            .as_ref()
            .map(|b| b.started_emitted)
            .unwrap_or(false)
        {
            self.close_reasoning();
        }
        if self
            .text
            .as_ref()
            .map(|b| b.started_emitted)
            .unwrap_or(false)
        {
            self.close_text();
        }
        for (_, tc) in &self.tool_calls {
            if !tc.started_emitted {
                continue;
            }
            let name = if tc.name.is_empty() { "tool" } else { &tc.name };
            (self.emit)(
                &self.workspace_dir,
                "session.next.tool.input.failed",
                json!({
                    "sessionID": self.session_id,
                    "messageID": self.assistant_msg_id,
                    "id": tc.call_id,
                    "name": name,
                    "error": { "message": "Tool execution was interrupted before completion." }
                }),
            );
        }
        self.content_parts
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[test]
    fn test_k05_block_switch_flushes_pending_and_keeps_text_unified() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        em.on_text_delta("satu");
        em.on_reasoning_delta("r");
        em.on_text_delta("dua");
        let out = em.finish_all();

        let kinds: Vec<String> = log.borrow().iter().map(|(k, _)| k.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                "session.next.text.started",
                "session.next.text.delta",
                "session.next.reasoning.started",
                "session.next.reasoning.delta",
                "session.next.reasoning.ended",
                "session.next.text.delta",
                "session.next.text.ended",
            ]
        );
        assert_eq!(out.text, "satudua");
        assert_eq!(out.reasoning, "r");
    }

    #[test]
    fn test_k03_tool_call_delta_assembly_and_input_events() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        em.on_tool_call_delta(0, Some("call_1"), Some("read"), Some("{\"pa"));
        em.on_tool_call_delta(0, None, None, Some("th\":\"a.txt\""));
        em.on_tool_call_delta(0, None, None, Some("}"));
        let out = em.finish_all();

        let events = log.borrow();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].0, "session.next.tool.input.started");
        assert_eq!(events[0].1["tool"], "read");
        assert_eq!(events[1].0, "session.next.tool.input.ended");
        assert_eq!(events[1].1["text"], "{\"path\":\"a.txt\"}");
        assert_eq!(events[2].0, "session.next.tool.called");
        assert_eq!(events[2].1["toolName"], "read");
        assert_eq!(events[2].1["input"], json!({ "path": "a.txt" }));
        assert_eq!(out.tool_calls[0]["function"]["name"], "read");
        assert_eq!(
            out.tool_calls[0]["function"]["arguments"],
            "{\"path\":\"a.txt\"}"
        );
    }

    #[test]
    fn test_k04_batch_coalesces_deltas_within_window() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        for i in 0..40 {
            em.on_text_delta(if i % 2 == 1 { "a" } else { "b" });
        }
        let out = em.finish_all();

        let delta_count = log
            .borrow()
            .iter()
            .filter(|(k, _)| k == "session.next.text.delta")
            .count();
        assert_eq!(delta_count, 1);
        assert_eq!(out.text.len(), 40);
    }

    #[test]
    fn test_k02_reasoning_to_text_switch_order() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        em.on_reasoning_delta("let me think");
        em.on_text_delta("jawaban");
        let _ = em.finish_all();

        let kinds: Vec<String> = log.borrow().iter().map(|(k, _)| k.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                "session.next.reasoning.started",
                "session.next.reasoning.delta",
                "session.next.text.started",
                "session.next.reasoning.ended",
                "session.next.text.delta",
                "session.next.text.ended",
            ]
        );
    }

    #[test]
    fn test_k06_close_started_on_abort_closes_started_and_omits_unstarted_parts() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        em.on_text_delta("par");
        em.on_text_delta("tial");
        // Un-named partial tool call should NOT emit tool.input.started on abort.
        em.on_tool_call_delta(0, Some("c1"), None, Some("{\"a\":1"));
        let parts = em.close_started_on_abort();
        let kinds: Vec<String> = log.borrow().iter().map(|(k, _)| k.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                "session.next.text.started",
                "session.next.text.delta",
                "session.next.text.ended",
            ]
        );
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["text"], "partial");
    }

    #[test]
    fn resolves_sparse_tool_call_indices_preserves_first_name_and_merges_reasoning() {
        let log: Rc<RefCell<Vec<(String, Value)>>> = Rc::new(RefCell::new(Vec::new()));
        let log_c = log.clone();
        let mut em = StreamStepEmitter::with_emitter("ws", "s1", "m1", move |_, kind, props| {
            log_c.borrow_mut().push((kind.to_string(), props));
        });

        em.on_reasoning_delta_with_field("reasoning", "step 1 ");
        em.on_reasoning_delta_with_field("reasoning_content", "step 2");
        em.on_reasoning_details(&json!([
            { "id": "rsn_0", "type": "reasoning.text", "text": "hello ", "signature": "sigA" }
        ]));
        em.on_reasoning_details(&json!([
            { "id": "rsn_0", "type": "reasoning.text", "text": "world" }
        ]));

        let idx0 = em.resolve_tool_call_index(None, Some("call_a"), 0);
        em.on_tool_call_delta(idx0, Some("call_a"), Some("write"), Some("{\"file"));
        // Subsequent continuation omits index and id, and sends an overwritten name that must not clobber "write"
        let idx0_cont = em.resolve_tool_call_index(None, None, 0);
        assert_eq!(idx0_cont, idx0);
        em.on_tool_call_delta(idx0_cont, None, Some("read"), Some("Path\":\"index.html\"}"));

        // Second tool call without explicit `index`, keyed only by new `id`
        let idx1 = em.resolve_tool_call_index(None, Some("call_b"), 0);
        assert_ne!(idx1, idx0);
        em.on_tool_call_delta(idx1, Some("call_b"), Some("bash"), Some("{\"command\":\"ls\"}"));

        let out = em.finish_all();
        assert_eq!(out.assistant_msg["reasoning"], json!("step 1 step 2"));
        assert!(out.assistant_msg.get("reasoning_content").is_none());
        let details = out.assistant_msg["reasoning_details"].as_array().unwrap();
        assert_eq!(details.len(), 1);
        assert_eq!(details[0]["text"], "hello world");
        assert_eq!(details[0]["signature"], "sigA");

        assert_eq!(out.tool_calls.len(), 2);
        assert_eq!(out.tool_calls[0]["function"]["name"], "write");
        assert_eq!(out.tool_calls[1]["function"]["name"], "bash");
    }
}
