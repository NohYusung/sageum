declare module '@dagrejs/dagre' {
  export namespace graphlib {
    class Graph {
      setDefaultEdgeLabel(callback: () => Record<string, never>): this;
      setGraph(options: Record<string, unknown>): this;
      setNode(id: string, options: { width: number; height: number }): this;
      setEdge(source: string, target: string): this;
      node(id: string): { x: number; y: number; width: number; height: number };
    }
  }

  export function layout(graph: graphlib.Graph): void;

  const dagre: {
    graphlib: typeof graphlib;
    layout: typeof layout;
  };
  export default dagre;
}
