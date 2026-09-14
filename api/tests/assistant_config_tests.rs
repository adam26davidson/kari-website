//! How the helper reads its configuration from the environment.
//!
//! This lives in its own integration-test binary ON PURPOSE. Environment
//! variables are process-global, and `assistant_tests.rs` deliberately injects
//! its configuration instead of setting any — so the two must not share a
//! process. Cargo gives each `tests/*.rs` file its own binary, which is the
//! cheapest possible isolation. Everything here runs in ONE test function for
//! the same reason: two tests in this binary would race each other.

use kari_website_api::services::anthropic::{AnthropicConfig, DEFAULT_MAX_TOKENS};
use kari_website_api::services::assistant::AssistantLimits;

/// Every variable this file touches, so setting and clearing cannot drift.
const ASSISTANT_VARS: [&str; 4] = [
    "ASSISTANT_MAX_TOOL_ITERATIONS_PER_TURN",
    "ASSISTANT_MAX_TURNS_PER_SESSION",
    "ASSISTANT_MAX_SESSION_TOKENS",
    "ASSISTANT_DAILY_TURN_LIMIT",
];

#[test]
fn the_spend_ceilings_can_be_tuned_on_the_host() {
    for var in ASSISTANT_VARS {
        std::env::remove_var(var);
    }
    std::env::remove_var("ANTHROPIC_MAX_TOKENS");
    std::env::remove_var("ANTHROPIC_API_KEY");

    // A host that configures nothing — which is every host today — gets the
    // built-in ceilings unchanged.
    assert_eq!(
        AssistantLimits::from_env(),
        AssistantLimits::default(),
        "an unconfigured host must keep the built-in ceilings"
    );

    // The maintainer can pull any ceiling down without a code change; this is
    // the lever that exists for the day the spend needs cutting in a hurry.
    std::env::set_var("ASSISTANT_MAX_TOOL_ITERATIONS_PER_TURN", "2");
    std::env::set_var("ASSISTANT_MAX_TURNS_PER_SESSION", "5");
    std::env::set_var("ASSISTANT_MAX_SESSION_TOKENS", "1000");
    std::env::set_var("ASSISTANT_DAILY_TURN_LIMIT", "7");
    let limits = AssistantLimits::from_env();
    assert_eq!(limits.max_tool_iterations_per_turn, 2);
    assert_eq!(limits.max_turns_per_session, 5);
    assert_eq!(limits.max_session_tokens, 1000);
    assert_eq!(limits.daily_turn_limit, 7);

    // A typo, or a zero that would turn a ceiling into "never", falls back to
    // the default rather than to a helper that refuses every message.
    std::env::set_var("ASSISTANT_DAILY_TURN_LIMIT", "lots");
    std::env::set_var("ASSISTANT_MAX_TURNS_PER_SESSION", "0");
    let limits = AssistantLimits::from_env();
    assert_eq!(
        limits.daily_turn_limit,
        AssistantLimits::default().daily_turn_limit
    );
    assert_eq!(
        limits.max_turns_per_session,
        AssistantLimits::default().max_turns_per_session
    );

    for var in ASSISTANT_VARS {
        std::env::remove_var(var);
    }

    // `max_tokens` is read the same way, and is the one Anthropic-side
    // ceiling worth reaching for when a turn is costing too much.
    std::env::set_var("ANTHROPIC_API_KEY", "test-key");
    let config = AnthropicConfig::from_env().expect("a key makes the helper configured");
    assert_eq!(config.max_tokens, DEFAULT_MAX_TOKENS);
    std::env::set_var("ANTHROPIC_MAX_TOKENS", "4096");
    assert_eq!(AnthropicConfig::from_env().unwrap().max_tokens, 4096);
    std::env::set_var("ANTHROPIC_MAX_TOKENS", "none");
    assert_eq!(
        AnthropicConfig::from_env().unwrap().max_tokens,
        DEFAULT_MAX_TOKENS
    );

    std::env::remove_var("ANTHROPIC_MAX_TOKENS");
    std::env::remove_var("ANTHROPIC_API_KEY");
}
