import Image from 'next/image';
import { ImageOff } from 'lucide-react';

type Props = { imageUrl: string | null; title: string };

export default function ReportThumbnail({ imageUrl, title }: Props) {
  return (
    <span className="report-thumbnail" role="img" aria-label={imageUrl ? `Photo for report: ${title}` : `No photo attached to report: ${title}`}>
      {imageUrl ? (
        <Image src={imageUrl} alt="" width={112} height={88} unoptimized className="report-thumbnail-image object-cover" />
      ) : (
        <span className="report-thumbnail-empty" aria-hidden="true"><ImageOff size={22} /><span>No photo</span></span>
      )}
    </span>
  );
}
