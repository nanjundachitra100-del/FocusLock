export type SampleExplanation = {
  id: string;
  title: string;
  topic: string;
  text: string;
};

/** Demo explanations only. Replace `text` with Gemma output later. */
export const SAMPLE_EXPLANATIONS: SampleExplanation[] = [
  {
    id: "linked-lists-c",
    title: "Linked Lists in C",
    topic: "Data Structures",
    text: "A linked list in C is a sequence of nodes, where each node stores a value and a pointer to the next node. Unlike an array, the nodes do not have to sit in contiguous memory, so inserting or deleting a node can be done by updating pointers instead of shifting every later element. The head pointer is the only guaranteed way to find the start of the list. If you overwrite head without saving the previous address, the remaining nodes become unreachable and that memory is leaked. A typical node uses a struct with an integer data field and a self-referential next pointer. Traversal starts at head and follows next until it becomes NULL. Always check for an empty list before dereferencing head, and keep a temporary pointer when you need to reconnect nodes during insertion or deletion.",
  },
  {
    id: "recursion",
    title: "The Art of Recursion",
    topic: "Algorithms",
    text: "Recursion solves a problem by calling the same function on a smaller input until a base case stops the process. Every recursive function needs at least one base case, such as n equals zero for factorial, and a recursive case that moves toward that base case. Each call waits on the call stack until the smaller problem returns. If the input never shrinks, the stack grows without bound and the program crashes. A useful way to think about recursion is: trust that the smaller call works, then combine its result with the current step. For linked lists, a recursive reverse would reverse the rest of the list, then make the following node point back to the current node, and finally return the new head. Trace a tiny example on paper before writing the code, and confirm that the function returns a value in every path.",
  },
  {
    id: "vectors-embeddings",
    title: "Vectors and Embeddings",
    topic: "Machine Learning",
    text: "A vector is an ordered list of numbers that can represent magnitude and direction in a mathematical space. In machine learning, an embedding is a vector that places a word, sentence, or other item so that similar items land close together. Distances and angles between embeddings become a way to measure similarity. For example, vector representations of related programming terms should be nearer than unrelated ones. Embeddings are usually learned from data rather than hand-written, so the coordinates themselves rarely have an obvious human meaning. What matters is the geometry: nearby points share meaning, and directions can capture relationships. When you study embeddings, focus on dimensionality, similarity metrics such as cosine similarity, and the idea that a model is compressing language into numbers a computer can compare.",
  },
];
