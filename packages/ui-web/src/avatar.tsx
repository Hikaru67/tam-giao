import { useState, type ImgHTMLAttributes } from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'size' | 'src'> {
  src?: string | null;
  initials?: string;
  size?: AvatarSize;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'w-8 h-8 text-label-sm',
  md: 'w-12 h-12 text-title-md',
  lg: 'w-16 h-16 text-headline-sm',
};

export function Avatar({ src, initials, alt = '', size = 'md', className = '', ...rest }: AvatarProps) {
  const [loadError, setLoadError] = useState(false);

  const showImage = Boolean(src) && !loadError;
  const initialText = initials?.trim().slice(0, 2).toUpperCase() || '?';

  return (
    <div
      className={`relative inline-flex items-center justify-center rounded-full overflow-hidden shrink-0 select-none ${sizeClasses[size]} ${className}`.trim()}
      aria-label={alt || initials || 'Ảnh đại diện'}
    >
      {showImage ? (
        <img
          src={src!}
          alt={alt}
          onError={() => setLoadError(true)}
          className="w-full h-full object-cover"
          {...rest}
        />
      ) : (
        <span className="w-full h-full flex items-center justify-center font-bold bg-primary-container text-on-primary-container">
          {initialText}
        </span>
      )}
    </div>
  );
}
