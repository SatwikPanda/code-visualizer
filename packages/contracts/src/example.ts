export const EXAMPLE_SOURCE = `class Solution {
    public int strStr(String haystack, String needle) {
        //The ideal solution is in O(n) time
        // the O(n) loop. we have to check all;
        int occurence = -1;
        int j = 0; //var for needle iter.
        int needleLength = needle.length();
        int haystackLength = haystack.length();

        for(int i = 0; i < haystackLength; i++) {
            char haystackChar = haystack.charAt(i);
            char needleChar = needle.charAt(j);

            // the base case where the length left is lesser that can be traversed
            if(j + haystackLength - i - 1 < needleLength) {
                return -1;
            }

            //if it exactly matches
            if(j == needleLength - 1) {
                return occurence;
            }

            //reset case where it doesn't match
            if(haystackChar != needleChar) {
                j = 0;
                occurence = -1;
            }

            // checking case
            if(haystackChar == needleChar) {
                if(j == 0) {
                    occurence = i;
                }
                j++;
            }
        }

        return occurence;
    }
}`;
