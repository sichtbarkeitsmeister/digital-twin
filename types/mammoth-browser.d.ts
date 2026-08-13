declare module "mammoth/mammoth.browser" {
  type ExtractResult = { value: string; messages: unknown[] };

  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<ExtractResult>;

  export function convertToHtml(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<ExtractResult>;

  const mammoth: {
    extractRawText: typeof extractRawText;
    convertToHtml: typeof convertToHtml;
  };
  export default mammoth;
}
