/**
 * Input field configuration for custom modal forms
 * Shared between ticket types and application positions
 * Allows admins to define custom questions for each type/position
 */
export interface CustomInputField {
  id: string; // Unique identifier (e.g., 'player_name', 'incident_date')
  label: string; // Field label shown to user (e.g., 'Player Name')
  style: 'short' | 'paragraph'; // Short = single line, paragraph = multi-line
  placeholder?: string; // Optional placeholder text
  required: boolean; // Whether field is required
  minLength?: number; // Minimum character length
  maxLength?: number; // Maximum character length (max 4000 for paragraph, 100 for short)
}
