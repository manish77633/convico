export type ReplyIntent = 'greeting' | 'planning' | 'debugging' | 'writing' | 'comparing' | 'continuing' | 'unknown';

export function isHinglishPrompt(prompt: string): boolean {
  return /[\u0900-\u097f]/.test(prompt) || /\b(kya|kaise|mujhe|mera|meri|hum|apne|aap|hai|hain|hoga|chahiye|bata|bta|samjha|karna|krna|karu|karo|nahi|nhi|kyu|kyon|likho|banao|mein)\b/i.test(prompt);
}

export function classifyPrompt(prompt: string): ReplyIntent {
  const value = prompt.toLowerCase();
  if (/\b(hi|hello|hey|namaste)\b/.test(value) || /नमस्ते|हैलो/.test(value)) return 'greeting';
  if (/\b(bug|error|crash|fix|debug|issue|problem|dikkat|galti)\b/.test(value) || /गलती|समस्या|एरर|बग|ठीक/.test(value)) return 'debugging';
  if (/\b(write|draft|email|letter|caption|likho|likhna)\b/.test(value) || /लिख|ईमेल|पत्र/.test(value)) return 'writing';
  if (/\b(compare|choose|better|versus|vs\.?|option|kaunsa)\b/.test(value) || /तुलना|बेहतर|कौन सा/.test(value)) return 'comparing';
  if (/\b(continue|more|next|further|elaborate|aur bata|aage)\b/.test(value) || /आगे|और बताओ/.test(value)) return 'continuing';
  if (/\b(plan|schedule|roadmap|steps|planning|kaise|banao|banana)\b/.test(value) || /योजना|प्लान|कैसे|बनाओ/.test(value)) return 'planning';
  return 'unknown';
}

export function createMockReply(prompt: string): string {
  const topic = prompt.trim().replace(/\s+/g, ' ').slice(0, 100);
  const hindi = isHinglishPrompt(prompt);
  const intent = classifyPrompt(prompt);

  if (hindi) {
    switch (intent) {
      case 'greeting': return 'Namaste! Kya help chahiye? Plan, writing ya bug ki baat batao.';
      case 'planning': return `“${topic}” ke liye simple plan:\n1. Goal aur deadline likho.\n2. Sabse chhota useful step chuno.\n3. Result dekhkar agla step decide karo.`;
      case 'debugging': return `“${topic}” solve karne ke liye:\n1. Error dobara chalao aur exact message dekho.\n2. Recent change check karo.\n3. Ek fix karke phir test karo.`;
      case 'writing': return `“${topic}” likhne ka easy tareeka:\n1. Main baat pehle likho.\n2. Zaroori detail jodo.\n3. End mein clear request rakho.`;
      case 'comparing': return `“${topic}” compare karne ke liye cost, time aur ease dekho. Har option ko same points par check karo. Current facts alag se verify karo.`;
      case 'continuing': return 'Aage badhte hain. Pichhli baat se ek chhota action chuno, use complete karo, phir result ke hisaab se next step lo.';
      default: return `“${topic}” par exact factual answer dene ke liye real AI ya source chahiye. Ye local mock hai. Aap goal aur context batao, main simple outline de sakta hoon.`;
    }
  }

  switch (intent) {
    case 'greeting': return 'Hello! What would you like help with? Ask for a plan, a writing outline, or debugging steps.';
    case 'planning': return `A simple plan for “${topic}”:\n1. Write the goal and deadline.\n2. Pick one small useful step.\n3. Check the result, then choose the next step.`;
    case 'debugging': return `To work on “${topic}”:\n1. Reproduce it and read the exact error.\n2. Check recent changes.\n3. Try one fix and test again.`;
    case 'writing': return `For “${topic}”:\n1. Say the main point first.\n2. Add only needed details.\n3. End with a clear request or next action.`;
    case 'comparing': return `To compare “${topic}”, check cost, time, and ease of use for each option. Verify current facts before deciding.`;
    case 'continuing': return 'Next, turn the previous idea into one small action. Finish it, check the result, and use that to choose the next step.';
    default: return `For “${topic}”, I cannot verify facts in this local mock. Share your goal and context, and I can give you a simple outline.`;
  }
}
