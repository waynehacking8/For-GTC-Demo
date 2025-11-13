import { deepResearchTool } from './deep-research.js';
import { thinkLongerTool } from './think-longer.js';

// Tool registry with all available AI SDK v5 tools
export const AVAILABLE_TOOLS = {
	deep_research: deepResearchTool,
	think_longer: thinkLongerTool
} as const;

// Type for tool names
export type ToolName = keyof typeof AVAILABLE_TOOLS;

// Type for a tool instance (inferred from the tool() helper)
export type ToolInstance = typeof AVAILABLE_TOOLS[ToolName];

/**
 * Get all tool names as an array of strings
 */
export function getAllToolNames(): string[] {
	return Object.keys(AVAILABLE_TOOLS);
}

/**
 * Get all available tools as an array
 */
export function getAllTools(): ToolInstance[] {
	return Object.values(AVAILABLE_TOOLS);
}

/**
 * Get tools as an object (for AI SDK v5 streamText)
 */
export function getToolsAsObject(toolNames?: string[]): Record<string, ToolInstance> {
	if (!toolNames || toolNames.length === 0) {
		return AVAILABLE_TOOLS as Record<string, ToolInstance>;
	}

	const result: Record<string, ToolInstance> = {};
	for (const name of toolNames) {
		if (name in AVAILABLE_TOOLS) {
			result[name] = AVAILABLE_TOOLS[name as ToolName];
		}
	}
	return result;
}

/**
 * Get specific tools by name (returns as array for backward compatibility)
 */
export function getTools(toolNames: string[]): ToolInstance[] {
	return toolNames
		.map(name => AVAILABLE_TOOLS[name as ToolName])
		.filter(Boolean);
}

/**
 * Get a single tool by name
 */
export function getTool(toolName: string): ToolInstance | undefined {
	return AVAILABLE_TOOLS[toolName as ToolName];
}

/**
 * Get display-friendly name for a tool
 */
export function getToolDisplayName(toolName: string): string {
	const displayNames: Record<string, string> = {
		deep_research: 'Deep Research',
		think_longer: 'Think Longer'
	};
	return displayNames[toolName] || toolName;
}

/**
 * Get description for a tool from its definition
 */
export function getToolDescription(toolName: string): string {
	const tool = AVAILABLE_TOOLS[toolName as ToolName];
	return tool?.description || 'No description available';
}

/**
 * Check if a tool name is valid
 */
export function isValidToolName(toolName: string): toolName is ToolName {
	return toolName in AVAILABLE_TOOLS;
}
