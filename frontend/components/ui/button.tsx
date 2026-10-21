import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * The primary treatment is "ignite": an orange fill rises from the bottom edge
 * of the button and the label goes dark. It works on :active for touch, and
 * on :focus-visible for the keyboard, with no JavaScript.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border whitespace-nowrap font-medium transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-55 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'ignite text-[13px] px-4 py-2',
        outline:
          'seam-btn border-seam bg-transparent text-ink hover:border-seam-strong hover:bg-plate-raised aria-expanded:bg-plate-raised',
        secondary:
          'border-transparent bg-plate-raised text-ink hover:border-seam hover:bg-muted',
        ghost:
          'border-transparent bg-transparent text-ink-muted hover:bg-plate hover:text-ink aria-expanded:bg-plate aria-expanded:text-ink',
        destructive:
          'ignite ignite--danger text-[13px] px-4 py-2',
        link: 'text-accent underline-offset-4 hover:underline px-0',
      },
      size: {
        default: 'h-9 gap-1.5',
        xs: 'h-6 gap-1 px-2 text-[11px] [&_svg:not([class*="size-"])]:size-3',
        sm: 'h-8 gap-1.5 px-3 text-[12.5px] [&_svg:not([class*="size-"])]:size-3.5',
        lg: 'h-11 gap-2 px-6 text-[14px]',
        icon: 'size-9',
        'icon-xs': 'size-6 [&_svg:not([class*="size-"])]:size-3',
        'icon-sm': 'size-8 [&_svg:not([class*="size-"])]:size-3.5',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
