import type { CustomInputField } from '../../../typeorm/entities/shared/CustomInputField';

interface PositionTemplate {
  name: string;
  title: string;
  description: string;
  emoji: string;
  ageGateEnabled: boolean;
  customFields: CustomInputField[];
}

const templates: Record<string, PositionTemplate> = {
  general: {
    name: 'General Application',
    title: 'General Application',
    description: 'Submit a general application to join our team. Fill out the form and our team will review it.',
    emoji: '📝',
    ageGateEnabled: false,
    customFields: [
      {
        id: 'name',
        label: 'Name',
        style: 'short',
        required: true,
        maxLength: 100,
      },
      {
        id: 'about',
        label: 'About Yourself',
        style: 'paragraph',
        required: true,
        placeholder: 'Tell us a bit about yourself...',
        maxLength: 2000,
      },
      {
        id: 'experience',
        label: 'Relevant Experience',
        style: 'paragraph',
        required: true,
        placeholder: 'Describe any relevant experience...',
        maxLength: 2000,
      },
      {
        id: 'why_applying',
        label: 'Why Are You Applying?',
        style: 'paragraph',
        required: true,
        placeholder: 'What interests you about this role?',
        maxLength: 2000,
      },
      {
        id: 'availability',
        label: 'Availability',
        style: 'short',
        required: true,
        placeholder: 'e.g., Weekdays 9-5 EST',
        maxLength: 100,
      },
    ],
  },
  staff: {
    name: 'Staff Application',
    title: 'Staff Application',
    description: 'Apply to become a staff member. Moderation experience and availability are key factors.',
    emoji: '🛡️',
    ageGateEnabled: true,
    customFields: [
      {
        id: 'name',
        label: 'Name',
        style: 'short',
        required: true,
        maxLength: 100,
      },
      {
        id: 'mod_experience',
        label: 'Moderation Experience',
        style: 'paragraph',
        required: true,
        placeholder: 'Describe your moderation experience...',
        maxLength: 2000,
      },
      {
        id: 'why_server',
        label: 'Why This Server?',
        style: 'paragraph',
        required: true,
        placeholder: 'What draws you to this community?',
        maxLength: 2000,
      },
      {
        id: 'timezone',
        label: 'Timezone / Availability',
        style: 'short',
        required: true,
        placeholder: 'e.g., EST, available evenings',
        maxLength: 100,
      },
      {
        id: 'age',
        label: 'Age',
        style: 'short',
        required: true,
        maxLength: 10,
      },
    ],
  },
  content_creator: {
    name: 'Content Creator',
    title: 'Content Creator Application',
    description: 'Apply as a content creator. Share your portfolio and creative experience.',
    emoji: '🎨',
    ageGateEnabled: false,
    customFields: [
      {
        id: 'name',
        label: 'Name',
        style: 'short',
        required: true,
        maxLength: 100,
      },
      {
        id: 'portfolio',
        label: 'Portfolio / Examples',
        style: 'paragraph',
        required: true,
        placeholder: 'Links to your portfolio or examples of your work...',
        maxLength: 2000,
      },
      {
        id: 'experience',
        label: 'Relevant Experience',
        style: 'paragraph',
        required: true,
        placeholder: 'Describe your content creation experience...',
        maxLength: 2000,
      },
      {
        id: 'tools',
        label: 'Tools / Software Used',
        style: 'short',
        required: true,
        placeholder: 'e.g., Photoshop, Premiere Pro, Blender',
        maxLength: 100,
      },
      {
        id: 'availability',
        label: 'Availability',
        style: 'short',
        required: true,
        placeholder: 'When are you available to create content?',
        maxLength: 100,
      },
    ],
  },
  developer: {
    name: 'Developer Application',
    title: 'Developer Application',
    description: 'Apply as a developer. Share your technical skills and project experience.',
    emoji: '💻',
    ageGateEnabled: false,
    customFields: [
      {
        id: 'name',
        label: 'Name',
        style: 'short',
        required: true,
        maxLength: 100,
      },
      {
        id: 'project_description',
        label: 'Project / Plugin Description',
        style: 'paragraph',
        required: true,
        placeholder: 'Describe your project or plugin...',
        maxLength: 2000,
      },
      {
        id: 'tech_skills',
        label: 'Technical Skills',
        style: 'paragraph',
        required: true,
        placeholder: 'List your technical skills and languages...',
        maxLength: 2000,
      },
      {
        id: 'portfolio_link',
        label: 'Repository / Portfolio Link',
        style: 'short',
        required: false,
        placeholder: 'e.g., github.com/username',
        maxLength: 200,
      },
      {
        id: 'goals',
        label: 'Integration Goals',
        style: 'paragraph',
        required: true,
        placeholder: 'What do you hope to achieve?',
        maxLength: 2000,
      },
    ],
  },
  partnership: {
    name: 'Partnership Application',
    title: 'Partnership Application',
    description: 'Apply for a partnership or collaboration. Tell us about your organization and goals.',
    emoji: '🤝',
    ageGateEnabled: false,
    customFields: [
      {
        id: 'org_name',
        label: 'Organization / Project Name',
        style: 'short',
        required: true,
        maxLength: 100,
      },
      {
        id: 'description',
        label: 'Description',
        style: 'paragraph',
        required: true,
        placeholder: 'Describe your organization or project...',
        maxLength: 2000,
      },
      {
        id: 'looking_for',
        label: "What You're Looking For",
        style: 'paragraph',
        required: true,
        placeholder: 'What kind of partnership are you seeking?',
        maxLength: 2000,
      },
      {
        id: 'links',
        label: 'Website / Links',
        style: 'short',
        required: false,
        placeholder: 'e.g., yoursite.com',
        maxLength: 200,
      },
      {
        id: 'contact',
        label: 'Contact Info',
        style: 'short',
        required: true,
        placeholder: 'Best way to reach you',
        maxLength: 100,
      },
    ],
  },
};

export function getTemplate(key: string): PositionTemplate | null {
  return templates[key] || null;
}
