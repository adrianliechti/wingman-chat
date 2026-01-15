import { useCallback, useMemo } from 'react';
import { useSkills } from './useSkills';
import type { Tool, ToolProvider } from '../types/chat';
import { Sparkles } from 'lucide-react';

export function useSkillsProvider(): ToolProvider | null {
  const { getEnabledSkills, getSkill } = useSkills();

  const getTools = useCallback((): Tool[] => {
    const enabledSkills = getEnabledSkills();
    
    if (enabledSkills.length === 0) {
      return [];
    }

    return [
      {
        name: 'read_skill',
        description: 'Read the full content and instructions of an available skill. Use this to get detailed instructions when you need to perform a task that matches a skill.',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The name of the skill to read. Must match one of the available skill names exactly.'
            }
          },
          required: ['name']
        },
        function: async (args: Record<string, unknown>): Promise<string> => {
          const skillName = args.name as string;

          if (!skillName) {
            return JSON.stringify({ error: 'No skill name provided' });
          }

          const skill = getSkill(skillName);

          if (!skill) {
            return JSON.stringify({ error: `Skill "${skillName}" not found` });
          }

          if (!skill.enabled) {
            return JSON.stringify({ error: `Skill "${skillName}" is disabled` });
          }

          return JSON.stringify({
            name: skill.name,
            description: skill.description,
            instructions: skill.content
          });
        }
      }
    ];
  }, [getEnabledSkills, getSkill]);

  const getInstructions = useCallback((): string => {
    const enabledSkills = getEnabledSkills();
    
    if (enabledSkills.length === 0) {
      return '';
    }

    const skillsXml = enabledSkills.map(skill => 
      `  <skill>
    <name>${skill.name}</name>
    <description>${skill.description}</description>
  </skill>`
    ).join('\n');

    return `## Skills

Skills are specialized prompts that provide detailed instructions for specific tasks. They expand your capabilities with domain expertise.

### How It Works

1. **Check available skills**: Review the skills listed below when users request a task
2. **Read skill instructions**: Use the \`read_skill\` tool to get detailed guidance
3. **Follow the instructions**: The skill provides step-by-step directions for the task
4. **Execute in conversation**: Complete the task directly in the main conversation

### When to Use Skills

- When a user's request matches an available skill's description
- When you need specialized guidance for a particular task
- When detailed, domain-specific instructions would improve your response

### Core Rules

1. **Only use listed skills**: Only use skills from \`<available_skills>\` below
2. **Read before executing**: Always use \`read_skill\` to get full instructions first
3. **Match by description**: Use skill descriptions to determine relevance
4. **Seamless execution**: Apply skill instructions naturally in your response

<available_skills>
${skillsXml}
</available_skills>`;
  }, [getEnabledSkills]);

  const provider = useMemo<ToolProvider | null>(() => {
    const enabledSkills = getEnabledSkills();
    
    // Return null if no enabled skills
    if (enabledSkills.length === 0) {
      return null;
    }

    const tools = getTools();
    const instructions = getInstructions();

    return {
      id: 'skills',
      name: 'Skills',
      description: 'Specialized agent skills',
      icon: Sparkles,
      instructions: instructions || undefined,
      tools: tools,
    };
  }, [getEnabledSkills, getTools, getInstructions]);

  return provider;
}
