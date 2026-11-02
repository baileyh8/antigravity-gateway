'use strict';
const HIDDEN_MODELS = new Set(['tab_flash_lite_preview', 'tab_jump_flash_lite_preview', 'chat_20706', 'chat_23310', 'gemini-2.5-pro']);
function publicModels(models) { return models.filter(id => !HIDDEN_MODELS.has(id)); }
module.exports = { publicModels };
