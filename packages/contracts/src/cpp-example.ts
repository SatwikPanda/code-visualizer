export const CPP_EXAMPLES = {
  vector: {
    label: "Vector & iterator",
    source: `#include <vector>
#include <algorithm>
using namespace std;

int sumVector(vector<int> values) {
    values.push_back(8);
    int total = 0;
    for (auto it = values.begin(); it != values.end(); ++it) {
        total += *it;
    }
    swap(values[0], values[2]);
    values.pop_back();
    return total;
}`,
    args: [["4", "2", "6"]],
  },
  stack: {
    label: "Stack & queue",
    source: `#include <stack>
#include <queue>
using namespace std;

int main() {
    stack<int> pending;
    queue<int> ready;
    pending.push(3);
    pending.push(7);
    ready.push(pending.top());
    pending.pop();
    ready.push(pending.top());
    pending.pop();
    int first = ready.front();
    ready.pop();
    return first;
}`,
    args: [],
  },
  map: {
    label: "Map & range loop",
    source: `#include <map>
#include <string>
using namespace std;

int main() {
    map<string, int> counts;
    counts["red"] = 2;
    counts["blue"] = 1;
    counts["red"] += 3;
    int total = 0;
    for (const auto& entry : counts) {
        total += entry.second;
    }
    counts.erase("blue");
    return total;
}`,
    args: [],
  },
};
