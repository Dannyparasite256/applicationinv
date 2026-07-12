import { useEffect, useState } from 'react';
import { getMediaUrl, brandInitials } from '@/lib/media';
import { cn } from '@/lib/utils';

type BrandMarkProps = {
  logoUrl?: string | null;
  name?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
};

/**
 * Company logo avatar for top bar / sidebar.
 * Falls back to initials when there is no logo or the image fails to load
 * (e.g. legacy /uploads paths wiped on redeploy).
 */
export function BrandMark({
  logoUrl,
  name,
  className,
  imgClassName,
  alt,
}: BrandMarkProps) {
  const src = getMediaUrl(logoUrl);
  const [failed, setFailed] = useState(false);

  // Reset error state when a new logo URL arrives (e.g. after upload or /auth/me)
  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImg = Boolean(src) && !failed;
  const label = alt || name || 'Business logo';

  return (
    <div
      className={cn('brand-mark', className)}
      title={name || undefined}
      aria-label={label}
    >
      {showImg ? (
        <img
          src={src!}
          alt={label}
          className={cn('h-full w-full object-cover', imgClassName)}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="select-none leading-none">{brandInitials(name)}</span>
      )}
    </div>
  );
}
