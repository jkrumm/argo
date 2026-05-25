import {
  createTheme,
  Input,
  NumberInput,
  PasswordInput,
  Select,
  Textarea,
  TextInput,
} from '@mantine/core'
import { DatePickerInput } from '@mantine/dates'

/**
 * Inputs default to `md` (16px font) so iOS Safari never zooms the viewport on
 * focus. The base `Input` default does not cascade to TextInput/Select/etc.
 * (each component resolves its own `size` and passes it down), so every input
 * is set explicitly. The CSS safety net in `styles/native.css` covers anything
 * not listed here.
 */
export const theme = createTheme({
  components: {
    Input: Input.extend({ defaultProps: { size: 'md' } }),
    TextInput: TextInput.extend({ defaultProps: { size: 'md' } }),
    NumberInput: NumberInput.extend({ defaultProps: { size: 'md' } }),
    PasswordInput: PasswordInput.extend({ defaultProps: { size: 'md' } }),
    Select: Select.extend({ defaultProps: { size: 'md' } }),
    Textarea: Textarea.extend({ defaultProps: { size: 'md' } }),
    DatePickerInput: DatePickerInput.extend({ defaultProps: { size: 'md' } }),
  },
})
