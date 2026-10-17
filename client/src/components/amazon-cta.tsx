const AMAZON_URL_PATTERN = /https:\/\/(?:www\.)?(?:amzn\.to\/[A-Za-z0-9]+|amazon\.com\/[^\s)]+)/;

export function extractAmazonUrl(content: string): string | null {
  const match = AMAZON_URL_PATTERN.exec(content);
  return match ? match[0] : null;
}

/**
 * 在文章正文后自动渲染一个高可见的亚马逊购买按钮。
 * 只有正文里带亚马逊推广链接的文章才会显示；无链接时返回 null。
 */
export function AmazonCta({ content }: { content: string }) {
  const url = extractAmazonUrl(content);
  if (!url) return null;
  return (
    <div className="my-8 flex justify-center">
      <a
        href={url}
        target="_blank"
        rel="sponsored nofollow noopener"
        className="inline-flex items-center gap-2 rounded-xl bg-[#FF9900] px-8 py-4 text-lg font-bold text-[#131921] shadow-lg transition-transform hover:scale-[1.03] active:scale-[0.98]"
      >
        Check the current price on Amazon
        <span aria-hidden="true">→</span>
      </a>
    </div>
  );
}
