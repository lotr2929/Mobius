// Router for handling AI requests
import { registry } from './modelRegistry.js';

export async function ask({ task, text, privateTask }) {
  const model = registry.findBest(task, privateTask);
  
  if (!model) {
    throw new Error('No AI models available');
  }
  
  try {
    const response = await model.ask({ text, task });
    return {
      model: model.displayName || model.name,
      response
    };
  } catch (error) {
    throw new Error(`${model.name} error: ${error.message}`);
  }
}
