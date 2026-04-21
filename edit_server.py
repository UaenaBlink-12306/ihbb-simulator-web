import json
import os
import re

with open('server.py', 'r', encoding='utf-8') as f:
    original_code = f.read()

# 1. Add validate_generated_question
validation_code = '''
def validate_generated_question(item: Dict[str, Any]) -> Dict[str, Any]:
    """Ask DeepSeek to validate a generated question for historical accuracy and IHBB format.
    Returns {valid: bool, reason: str}.
    """
    if not DEEPSEEK_API_KEY:
        return {"valid": True, "reason": "Validation skipped (no API key)"}
    question = string_value(item.get("question"))
    answer = string_value(item.get("answer"))
    if not question or not answer:
        return {"valid": False, "reason": "Missing question or answer text"}
    system = (
        "You are a quality checker for IHBB (International History Bee and Bowl) tossup questions.\\n"
        "Given a question and its expected answer, check:\\n"
        "1. Is the question historically accurate? Are the facts correct?\\n"
        "2. Does it follow pyramid format (4 sentences, hardest clue first, giveaway last)?\\n"
        "3. Does the last sentence start with 'For the point'?\\n"
        "4. Is the answer unambiguous and clearly the only correct response?\\n"
        "5. Does the question avoid revealing the answer before the final sentence?\\n"
        "Return strict JSON: {\\"valid\\": boolean, \\"reason\\": \\"short explanation\\"}"
    )
    user_payload = {"question": question, "answer": answer}
    try:
        obj = call_deepseek(
            [{"role": "system", "content": system}, {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)}],
            max_tokens=150,
            temperature=0.0,
        )
        if isinstance(obj, dict) and isinstance(obj.get("valid"), bool):
            return {"valid": bool(obj["valid"]), "reason": string_value(obj.get("reason", ""))}
    except Exception as exc:
        log.warning("DeepSeek validation call failed: %s", exc)
    # If validation call fails, accept the question (don't block on API issues)
    return {"valid": True, "reason": "Validation call failed; accepted by default"}


def generate_questions_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:'''

code = original_code.replace(
    'def generate_questions_with_deepseek(payload: Dict[str, Any]) -> Dict[str, Any]:', 
    validation_code
)

# 2. Modify the return block and persistence
new_return = '''        if not items:
            return {"error": "DeepSeek returned no valid generated questions."}

        # Validate each generated question with DeepSeek
        skip_validation = bool(payload.get("skip_validation", False))
        validated_items: List[Dict[str, Any]] = []
        validation_results: List[Dict[str, Any]] = []
        for item in items:
            if skip_validation:
                validated_items.append(item)
                validation_results.append({"valid": True, "reason": "Validation skipped"})
            else:
                result = validate_generated_question(item)
                validation_results.append(result)
                if result.get("valid"):
                    validated_items.append(item)
                else:
                    log.info(
                        "Generated question rejected by validation: answer=%s reason=%s",
                        string_value(item.get("answer", "")),
                        result.get("reason", ""),
                    )

        if not validated_items:
            return {"error": "All generated questions failed validation.", "validation_results": validation_results}

        # Persist validated questions to shared bank + questions.json
        persistence = {}
        try:
            persistence = persist_generated_items(validated_items)
            log.info(
                "Generated questions persisted: bank_added=%s, questions_json_added=%s",
                persistence.get("shared_bank_added", 0),
                persistence.get("questions_json_added", 0),
            )
        except Exception as exc:
            log.warning("Generated questions persistence failed: %s", exc)
            persistence = {"warning": f"Persistence failed: {exc}"}

        return {
            "source": "deepseek",
            "requested": count,
            "returned": len(validated_items),
            "items": validated_items,
            "persistence": persistence,
            "validated": len(validated_items),
            "rejected": len(items) - len(validated_items),
        }'''

old_return_pattern = re.compile(
    r'        if not items:\s+return \{"error": "DeepSeek returned no valid generated questions."\}\s+return \s*\{\s*"source": "deepseek",\s*"requested": count,\s*"returned": len\(items\),\s*"items": items,\s*\}', 
    re.MULTILINE | re.DOTALL
)

if old_return_pattern.search(code):
    code = old_return_pattern.sub(new_return.replace('\\n', '\\r\\n'), code)
    with open('server.py', 'w', encoding='utf-8', newline='') as f:
        f.write(code)
    print("Success!")
else:
    print("Failed to match return block.")
