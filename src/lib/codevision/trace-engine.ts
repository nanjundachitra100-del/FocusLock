/**
 * CodeVision deterministic execution-trace engine.
 * This is a SIMULATED tracer — it does NOT execute arbitrary C code.
 * It replays pre-authored execution traces for included example programs.
 */

export type CVarValue = number | string | null;

export interface CVariable {
  name: string;
  type: string;
  value: CVarValue;
  address: string;        // illustrative hex address
  isPointer?: boolean;
  pointsTo?: string | null; // address it points to
  changed?: boolean;      // highlighted this step
}

export interface CStackFrame {
  functionName: string;
  locals: CVariable[];
  returnAddress?: string;
}

export interface CHeapNode {
  address: string;        // illustrative
  fields: CVariable[];
  nextAddress: string | null; // for linked list
  label?: string;
  isActive?: boolean;     // highlighted this step
  isNew?: boolean;        // just allocated
}

export interface CPointerArrow {
  fromAddress: string;
  fromLabel: string;
  toAddress: string | null; // null = NULL
}

export interface CLinkedListNode {
  address: string;
  data: CVarValue;
  nextAddress: string | null;
  isHead?: boolean;
  isActive?: boolean;
}

export interface TraceStep {
  stepIndex: number;
  activeLine: number;        // 1-based
  highlightLines: number[];  // 1-based
  explanation: string;
  stack: CStackFrame[];
  heap: CHeapNode[];
  pointers: CPointerArrow[];
  linkedList: CLinkedListNode[];
}

export interface TraceProgram {
  id: string;
  title: string;
  description: string;
  code: string;
  steps: TraceStep[];
}

// ─── Example 1: Array traversal ──────────────────────────────────────────────

const ARRAY_CODE = `#include <stdio.h>

int main(void) {
    int arr[5] = {10, 20, 30, 40, 50};
    int sum = 0;
    int i;

    for (i = 0; i < 5; i++) {
        sum = sum + arr[i];
    }

    printf("Sum = %d\\n", sum);
    return 0;
}`;

const ARRAY_TRACE: TraceStep[] = [
  {
    stepIndex: 0,
    activeLine: 4,
    highlightLines: [4],
    explanation: "Declare array arr[5] and initialize it with {10, 20, 30, 40, 50}. Five integers are stored consecutively in memory.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 1,
    activeLine: 5,
    highlightLines: [5],
    explanation: "Declare sum = 0. This will accumulate the total of all array elements.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 0, address: "0x1014", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 2,
    activeLine: 8,
    highlightLines: [8],
    explanation: "Loop starts: i = 0. Condition i < 5 is true, so we enter the loop body.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 0, address: "0x1014" },
      { name: "i", type: "int", value: 0, address: "0x1018", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 3,
    activeLine: 9,
    highlightLines: [9],
    explanation: "i=0: sum = 0 + arr[0] = 0 + 10 = 10. We access arr[0] at address 0x1000.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 10, address: "0x1014", changed: true },
      { name: "i", type: "int", value: 0, address: "0x1018" },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 4,
    activeLine: 9,
    highlightLines: [9],
    explanation: "i=1: sum = 10 + arr[1] = 10 + 20 = 30.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 30, address: "0x1014", changed: true },
      { name: "i", type: "int", value: 1, address: "0x1018", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 5,
    activeLine: 9,
    highlightLines: [9],
    explanation: "i=2: sum = 30 + arr[2] = 30 + 30 = 60.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 60, address: "0x1014", changed: true },
      { name: "i", type: "int", value: 2, address: "0x1018", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 6,
    activeLine: 9,
    highlightLines: [9],
    explanation: "i=3: sum = 60 + arr[3] = 60 + 40 = 100.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 100, address: "0x1014", changed: true },
      { name: "i", type: "int", value: 3, address: "0x1018", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 7,
    activeLine: 9,
    highlightLines: [9],
    explanation: "i=4: sum = 100 + arr[4] = 100 + 50 = 150. All elements processed.",
    stack: [{ functionName: "main", locals: [
      { name: "arr[0]", type: "int", value: 10, address: "0x1000" },
      { name: "arr[1]", type: "int", value: 20, address: "0x1004" },
      { name: "arr[2]", type: "int", value: 30, address: "0x1008" },
      { name: "arr[3]", type: "int", value: 40, address: "0x100C" },
      { name: "arr[4]", type: "int", value: 50, address: "0x1010" },
      { name: "sum", type: "int", value: 150, address: "0x1014", changed: true },
      { name: "i", type: "int", value: 4, address: "0x1018", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 8,
    activeLine: 12,
    highlightLines: [12],
    explanation: "printf outputs 'Sum = 150'. The loop iterated 5 times, accumulating all values.",
    stack: [{ functionName: "main", locals: [
      { name: "sum", type: "int", value: 150, address: "0x1014" },
      { name: "i", type: "int", value: 5, address: "0x1018" },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
];

// ─── Example 2: Pointer modification ─────────────────────────────────────────

const POINTER_CODE = `#include <stdio.h>

void double_it(int *p) {
    *p = *p * 2;
}

int main(void) {
    int x = 5;
    int *ptr = &x;

    printf("Before: x = %d\\n", x);
    double_it(ptr);
    printf("After:  x = %d\\n", x);

    *ptr = *ptr + 10;
    printf("Final:  x = %d\\n", x);
    return 0;
}`;

const POINTER_TRACE: TraceStep[] = [
  {
    stepIndex: 0,
    activeLine: 8,
    highlightLines: [8],
    explanation: "Declare int x = 5. The integer value 5 is stored at memory address 0x2000.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 5, address: "0x2000", changed: true },
    ]}],
    heap: [],
    pointers: [],
    linkedList: [],
  },
  {
    stepIndex: 1,
    activeLine: 9,
    highlightLines: [9],
    explanation: "Declare int *ptr = &x. ptr stores the address of x (0x2000). ptr itself lives at 0x2004.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 5, address: "0x2000" },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000", changed: true },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
  {
    stepIndex: 2,
    activeLine: 11,
    highlightLines: [11],
    explanation: "printf outputs 'Before: x = 5'. x has not been modified yet.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 5, address: "0x2000" },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
  {
    stepIndex: 3,
    activeLine: 12,
    highlightLines: [12],
    explanation: "Call double_it(ptr). A new stack frame is pushed. Parameter p receives a copy of ptr's value (0x2000).",
    stack: [
      { functionName: "main", locals: [
        { name: "x", type: "int", value: 5, address: "0x2000" },
        { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
      ]},
      { functionName: "double_it", locals: [
        { name: "p", type: "int*", value: "0x2000", address: "0x3000", isPointer: true, pointsTo: "0x2000", changed: true },
      ]},
    ],
    heap: [],
    pointers: [
      { fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" },
      { fromAddress: "0x3000", fromLabel: "p", toAddress: "0x2000" },
    ],
    linkedList: [],
  },
  {
    stepIndex: 4,
    activeLine: 4,
    highlightLines: [4],
    explanation: "*p = *p * 2 → dereference p to get x (5), multiply by 2, write 10 back to address 0x2000. x is now 10.",
    stack: [
      { functionName: "main", locals: [
        { name: "x", type: "int", value: 10, address: "0x2000", changed: true },
        { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
      ]},
      { functionName: "double_it", locals: [
        { name: "p", type: "int*", value: "0x2000", address: "0x3000", isPointer: true, pointsTo: "0x2000" },
      ]},
    ],
    heap: [],
    pointers: [
      { fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" },
      { fromAddress: "0x3000", fromLabel: "p", toAddress: "0x2000" },
    ],
    linkedList: [],
  },
  {
    stepIndex: 5,
    activeLine: 12,
    highlightLines: [12],
    explanation: "double_it returns. Its stack frame is popped. Control returns to main. x remains 10.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 10, address: "0x2000" },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
  {
    stepIndex: 6,
    activeLine: 13,
    highlightLines: [13],
    explanation: "printf outputs 'After: x = 10'. The function modified x through the pointer.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 10, address: "0x2000" },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
  {
    stepIndex: 7,
    activeLine: 15,
    highlightLines: [15],
    explanation: "*ptr = *ptr + 10 → dereference ptr to get x (10), add 10, write 20 back. x is now 20.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 20, address: "0x2000", changed: true },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
  {
    stepIndex: 8,
    activeLine: 16,
    highlightLines: [16],
    explanation: "printf outputs 'Final: x = 20'. Pointers let us modify variables indirectly by address.",
    stack: [{ functionName: "main", locals: [
      { name: "x", type: "int", value: 20, address: "0x2000" },
      { name: "ptr", type: "int*", value: "0x2000", address: "0x2004", isPointer: true, pointsTo: "0x2000" },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x2004", fromLabel: "ptr", toAddress: "0x2000" }],
    linkedList: [],
  },
];

// ─── Example 3: Linked-list insertion ────────────────────────────────────────

const LINKED_LIST_CODE = `#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int data;
    struct Node* next;
} Node;

Node* create_node(int value) {
    Node* node = (Node*)malloc(sizeof(Node));
    node->data = value;
    node->next = NULL;
    return node;
}

int main(void) {
    Node* head = NULL;
    Node* n1 = create_node(10);
    Node* n2 = create_node(20);
    Node* n3 = create_node(30);

    head = n1;
    n1->next = n2;
    n2->next = n3;

    // Traverse
    Node* cur = head;
    while (cur != NULL) {
        printf("%d -> ", cur->data);
        cur = cur->next;
    }
    printf("NULL\\n");
    return 0;
}`;

const LINKED_LIST_TRACE: TraceStep[] = [
  {
    stepIndex: 0,
    activeLine: 17,
    highlightLines: [17],
    explanation: "Declare Node* head = NULL. The list is empty. head points to nothing.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "NULL", address: "0x4000", isPointer: true, pointsTo: null, changed: true },
    ]}],
    heap: [],
    pointers: [{ fromAddress: "0x4000", fromLabel: "head", toAddress: null }],
    linkedList: [],
  },
  {
    stepIndex: 1,
    activeLine: 18,
    highlightLines: [9, 10, 11, 12, 18],
    explanation: "create_node(10): malloc allocates a Node on the heap at 0x5000. data=10, next=NULL. Returns 0x5000.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "NULL", address: "0x4000", isPointer: true, pointsTo: null },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000", changed: true },
    ]}],
    heap: [{ address: "0x5000", label: "Node n1", isNew: true, fields: [
      { name: "data", type: "int", value: 10, address: "0x5000" },
      { name: "next", type: "Node*", value: "NULL", address: "0x5004", isPointer: true, pointsTo: null },
    ], nextAddress: null }],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: null },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
    ],
    linkedList: [{ address: "0x5000", data: 10, nextAddress: null }],
  },
  {
    stepIndex: 2,
    activeLine: 19,
    highlightLines: [9, 10, 11, 12, 19],
    explanation: "create_node(20): malloc allocates another Node on the heap at 0x5010. data=20, next=NULL.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "NULL", address: "0x4000", isPointer: true, pointsTo: null },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000" },
      { name: "n2", type: "Node*", value: "0x5010", address: "0x4010", isPointer: true, pointsTo: "0x5010", changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [
        { name: "data", type: "int", value: 10, address: "0x5000" },
        { name: "next", type: "Node*", value: "NULL", address: "0x5004", isPointer: true, pointsTo: null },
      ], nextAddress: null },
      { address: "0x5010", label: "Node n2", isNew: true, fields: [
        { name: "data", type: "int", value: 20, address: "0x5010" },
        { name: "next", type: "Node*", value: "NULL", address: "0x5014", isPointer: true, pointsTo: null },
      ], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: null },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
      { fromAddress: "0x4010", fromLabel: "n2", toAddress: "0x5010" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: null },
      { address: "0x5010", data: 20, nextAddress: null },
    ],
  },
  {
    stepIndex: 3,
    activeLine: 20,
    highlightLines: [20],
    explanation: "create_node(30): malloc allocates Node at 0x5020. data=30, next=NULL.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "NULL", address: "0x4000", isPointer: true, pointsTo: null },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000" },
      { name: "n2", type: "Node*", value: "0x5010", address: "0x4010", isPointer: true, pointsTo: "0x5010" },
      { name: "n3", type: "Node*", value: "0x5020", address: "0x4018", isPointer: true, pointsTo: "0x5020", changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "NULL", address: "0x5004", isPointer: true, pointsTo: null }], nextAddress: null },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "NULL", address: "0x5014", isPointer: true, pointsTo: null }], nextAddress: null },
      { address: "0x5020", label: "Node n3", isNew: true, fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: null },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
      { fromAddress: "0x4010", fromLabel: "n2", toAddress: "0x5010" },
      { fromAddress: "0x4018", fromLabel: "n3", toAddress: "0x5020" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: null },
      { address: "0x5010", data: 20, nextAddress: null },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 4,
    activeLine: 22,
    highlightLines: [22],
    explanation: "head = n1 → head now points to Node n1 at 0x5000. This is the start of the list.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000", changed: true },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000" },
      { name: "n2", type: "Node*", value: "0x5010", address: "0x4010", isPointer: true, pointsTo: "0x5010" },
      { name: "n3", type: "Node*", value: "0x5020", address: "0x4018", isPointer: true, pointsTo: "0x5020" },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", isActive: true, fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "NULL", address: "0x5004", isPointer: true, pointsTo: null }], nextAddress: null },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "NULL", address: "0x5014", isPointer: true, pointsTo: null }], nextAddress: null },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
      { fromAddress: "0x4010", fromLabel: "n2", toAddress: "0x5010" },
      { fromAddress: "0x4018", fromLabel: "n3", toAddress: "0x5020" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: null, isHead: true },
      { address: "0x5010", data: 20, nextAddress: null },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 5,
    activeLine: 23,
    highlightLines: [23],
    explanation: "n1->next = n2 → write 0x5010 into n1's next field. Node n1 now points to Node n2.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000" },
      { name: "n2", type: "Node*", value: "0x5010", address: "0x4010", isPointer: true, pointsTo: "0x5010" },
      { name: "n3", type: "Node*", value: "0x5020", address: "0x4018", isPointer: true, pointsTo: "0x5020" },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", isActive: true, fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010", changed: true }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "NULL", address: "0x5014", isPointer: true, pointsTo: null }], nextAddress: null },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
      { fromAddress: "0x4010", fromLabel: "n2", toAddress: "0x5010" },
      { fromAddress: "0x4018", fromLabel: "n3", toAddress: "0x5020" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true },
      { address: "0x5010", data: 20, nextAddress: null },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 6,
    activeLine: 24,
    highlightLines: [24],
    explanation: "n2->next = n3 → write 0x5020 into n2's next field. The list is now: 10 → 20 → 30 → NULL.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "n1", type: "Node*", value: "0x5000", address: "0x4008", isPointer: true, pointsTo: "0x5000" },
      { name: "n2", type: "Node*", value: "0x5010", address: "0x4010", isPointer: true, pointsTo: "0x5010" },
      { name: "n3", type: "Node*", value: "0x5020", address: "0x4018", isPointer: true, pointsTo: "0x5020" },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010" }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", isActive: true, fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "0x5020", address: "0x5014", isPointer: true, pointsTo: "0x5020", changed: true }], nextAddress: "0x5020" },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4008", fromLabel: "n1", toAddress: "0x5000" },
      { fromAddress: "0x4010", fromLabel: "n2", toAddress: "0x5010" },
      { fromAddress: "0x4018", fromLabel: "n3", toAddress: "0x5020" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true },
      { address: "0x5010", data: 20, nextAddress: "0x5020" },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 7,
    activeLine: 27,
    highlightLines: [27],
    explanation: "cur = head → cur points to the first node (0x5000). Begin traversal.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "cur", type: "Node*", value: "0x5000", address: "0x4020", isPointer: true, pointsTo: "0x5000", changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", isActive: true, fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010" }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "0x5020", address: "0x5014", isPointer: true, pointsTo: "0x5020" }], nextAddress: "0x5020" },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4020", fromLabel: "cur", toAddress: "0x5000" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true, isActive: true },
      { address: "0x5010", data: 20, nextAddress: "0x5020" },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 8,
    activeLine: 29,
    highlightLines: [29],
    explanation: "cur->data = 10. printf outputs '10 -> '. Then cur = cur->next moves cur to 0x5010 (Node n2).",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "cur", type: "Node*", value: "0x5010", address: "0x4020", isPointer: true, pointsTo: "0x5010", changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010" }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", isActive: true, fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "0x5020", address: "0x5014", isPointer: true, pointsTo: "0x5020" }], nextAddress: "0x5020" },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4020", fromLabel: "cur", toAddress: "0x5010" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true },
      { address: "0x5010", data: 20, nextAddress: "0x5020", isActive: true },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
  {
    stepIndex: 9,
    activeLine: 29,
    highlightLines: [29],
    explanation: "cur->data = 20. printf outputs '20 -> '. cur = cur->next moves to 0x5020 (Node n3).",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "cur", type: "Node*", value: "0x5020", address: "0x4020", isPointer: true, pointsTo: "0x5020", changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010" }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "0x5020", address: "0x5014", isPointer: true, pointsTo: "0x5020" }], nextAddress: "0x5020" },
      { address: "0x5020", label: "Node n3", isActive: true, fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4020", fromLabel: "cur", toAddress: "0x5020" },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true },
      { address: "0x5010", data: 20, nextAddress: "0x5020" },
      { address: "0x5020", data: 30, nextAddress: null, isActive: true },
    ],
  },
  {
    stepIndex: 10,
    activeLine: 31,
    highlightLines: [31],
    explanation: "cur->data = 30. printf outputs '30 -> '. cur = cur->next = NULL. Loop ends. printf outputs 'NULL'. Traversal complete: 10 → 20 → 30 → NULL.",
    stack: [{ functionName: "main", locals: [
      { name: "head", type: "Node*", value: "0x5000", address: "0x4000", isPointer: true, pointsTo: "0x5000" },
      { name: "cur", type: "Node*", value: "NULL", address: "0x4020", isPointer: true, pointsTo: null, changed: true },
    ]}],
    heap: [
      { address: "0x5000", label: "Node n1", fields: [{ name: "data", type: "int", value: 10, address: "0x5000" }, { name: "next", type: "Node*", value: "0x5010", address: "0x5004", isPointer: true, pointsTo: "0x5010" }], nextAddress: "0x5010" },
      { address: "0x5010", label: "Node n2", fields: [{ name: "data", type: "int", value: 20, address: "0x5010" }, { name: "next", type: "Node*", value: "0x5020", address: "0x5014", isPointer: true, pointsTo: "0x5020" }], nextAddress: "0x5020" },
      { address: "0x5020", label: "Node n3", fields: [{ name: "data", type: "int", value: 30, address: "0x5020" }, { name: "next", type: "Node*", value: "NULL", address: "0x5024", isPointer: true, pointsTo: null }], nextAddress: null },
    ],
    pointers: [
      { fromAddress: "0x4000", fromLabel: "head", toAddress: "0x5000" },
      { fromAddress: "0x4020", fromLabel: "cur", toAddress: null },
    ],
    linkedList: [
      { address: "0x5000", data: 10, nextAddress: "0x5010", isHead: true },
      { address: "0x5010", data: 20, nextAddress: "0x5020" },
      { address: "0x5020", data: 30, nextAddress: null },
    ],
  },
];

// ─── Registry ─────────────────────────────────────────────────────────────────

export const TRACE_PROGRAMS: TraceProgram[] = [
  {
    id: "array-traversal",
    title: "Array Traversal",
    description: "Sum all elements of an integer array using a for loop.",
    code: ARRAY_CODE,
    steps: ARRAY_TRACE,
  },
  {
    id: "pointer-modification",
    title: "Pointer Modification",
    description: "Modify a variable through a pointer, including inside a function.",
    code: POINTER_CODE,
    steps: POINTER_TRACE,
  },
  {
    id: "linked-list-insertion",
    title: "Linked List Insertion",
    description: "Build a singly linked list using malloc and traverse it.",
    code: LINKED_LIST_CODE,
    steps: LINKED_LIST_TRACE,
  },
];
